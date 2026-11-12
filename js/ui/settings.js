// Dialóg nastavení: kľúče, hlas (aj klonovanie), oprava reči, zvuk, prenos do telefónu.
import qrcode from '../../vendor/qrcode.js';
import { store } from '../store.js';
import { SonioxRest, voiceStatus } from '../soniox-rest.js';
import { Refiner } from '../refiner.js';
import { MicCapture, canPickOutput } from '../audio.js';
import { encodeWav } from '../core/pcm.js';
import { LLM_MODELS, REGIONS, DEFAULT_VOICE, exportConfig, importConfig, voiceFor } from '../core/config.js';
import { languageLabel } from '../core/languages.js';
import { $, toast, fillSelect, qrSvg } from './dom.js';
import { openLanguagePicker } from './languages.js';

const dialog = $('#dlgSettings');
const MAX_SAMPLE_SECONDS = 115;
const SAMPLE_PHRASES = {
  sk: 'Dobrý deň, takto znie môj hlas v preklade.',
  en: 'Hello, this is how my voice sounds in translation.',
  de: 'Guten Tag, so klingt meine Stimme in der Übersetzung.',
  cs: 'Dobrý den, takhle zní můj hlas v překladu.',
};

let deps = null;
let voices = { mine: [], shared: [] };
let sample = null; // { blob, filename }
let recorder = null;

const rest = () => new SonioxRest({ base: store.endpoints.rest, apiKey: store.all.sonioxKey });

function result(node, text, kind = '') {
  node.textContent = text;
  node.className = `result ${kind}`;
}

// --- vyplnenie formulára ----------------------------------------------------------

function render() {
  const s = store.all;
  $('#setSonioxKey').value = s.sonioxKey || '';
  $('#setAnthropicKey').value = s.anthropicKey || '';
  fillSelect($('#setRegion'), REGIONS.map((r) => ({ label: r.label, value: r.id })), s.region);
  $('#setSmart').checked = s.smart;
  fillSelect($('#setLlmModel'), LLM_MODELS.map((m) => ({ label: m.label, value: m.id })), s.llmModel);
  $('#setGlossary').value = s.glossary;
  $('#setInstructions').value = s.instructions;
  $('#setHeadphones').checked = s.headphones;
  $('#setResponsiveness').value = s.responsiveness;
  $('#setSpeed').value = s.speed;
  $('#speedOut').textContent = `${Number(s.speed).toFixed(2)}×`;
  $('#setPwaUrl').value = s.pwaUrl;
  $('#setSttModel').value = s.sttModel;
  $('#setTtsModel').value = s.ttsModel;
  $('#versionInfo').textContent = globalThis.desktop ? `Tlmočník pre Windows ${globalThis.desktop.version || ''}` : 'Tlmočník – webová aplikácia';
  renderVoices();
  renderMyLanguages();
}

function renderVoices() {
  const s = store.all;
  const model = s.ttsModel;
  const mine = voices.mine.map((v) => {
    const status = voiceStatus(v, model);
    const suffix = status === 'ready' ? '' : status === 'processing' ? ' (spracúva sa…)' : ' (nepripravený)';
    return { label: v.name + suffix, value: v.id };
  });
  const shared = voices.shared.map((v) => ({
    label: `${v.id}${v.gender ? ` – ${v.gender === 'female' ? 'ženský' : v.gender === 'male' ? 'mužský' : 'neutrálny'}` : ''}`,
    value: v.id,
  }));
  const groups = [
    { group: 'Moje hlasy', options: mine },
    { group: 'Vstavané hlasy', options: shared.length ? shared : [{ label: DEFAULT_VOICE, value: DEFAULT_VOICE }] },
  ];
  fillSelect($('#setVoiceMine'), groups, s.voiceMine || DEFAULT_VOICE);
  fillSelect($('#setVoiceOther'), [{ label: 'Rovnaký ako môj', value: '' }, ...groups], s.voiceOther);
  $('#btnDeleteVoice').hidden = !voices.mine.some((v) => v.id === s.voiceMine);
}

async function loadVoices() {
  if (!store.all.sonioxKey) return;
  try {
    const api = rest();
    const [mine, shared] = await Promise.all([api.listVoices(), api.listSharedVoices(store.all.ttsModel).catch(() => [])]);
    voices = { mine, shared };
    renderVoices();
  } catch (err) {
    result($('#voiceResult'), err.message, 'bad');
  }
}

function renderMyLanguages() {
  const s = store.all;
  const box = $('#myLangs');
  box.replaceChildren();
  for (const code of s.myLanguages) {
    const inUse = code === s.langA || code === s.langB;
    const chip = document.createElement('span');
    chip.className = `chip ${inUse ? 'fixed' : ''}`;
    chip.textContent = languageLabel(code);
    if (!inUse) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '✕';
      remove.setAttribute('aria-label', `Odobrať ${languageLabel(code)}`);
      remove.addEventListener('click', () => store.update({ myLanguages: s.myLanguages.filter((c) => c !== code) }));
      chip.append(remove);
    }
    box.append(chip);
  }
}

async function renderDevices() {
  const s = store.all;
  let devices = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    /* bez prístupu k zariadeniam */
  }
  const list = (kind, fallback) => [
    { label: fallback, value: '' },
    ...devices.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default').map((d, i) => ({ label: d.label || `Zariadenie ${i + 1}`, value: d.deviceId })),
  ];
  fillSelect($('#setMic'), list('audioinput', 'Predvolený mikrofón'), s.micDeviceId);
  $('#outRow').hidden = !canPickOutput();
  fillSelect($('#setOut'), list('audiooutput', 'Predvolený výstup'), s.outDeviceId);
}

// --- ukladanie ----------------------------------------------------------------------

function bind(selector, key, read = (el) => el.value, event = 'change') {
  $(selector).addEventListener(event, (e) => store.update({ [key]: read(e.target) }));
}

function bindAll() {
  const trimmed = (el) => el.value.trim();
  const checked = (el) => el.checked;
  bind('#setSonioxKey', 'sonioxKey', trimmed);
  bind('#setAnthropicKey', 'anthropicKey', trimmed);
  bind('#setRegion', 'region');
  bind('#setSmart', 'smart', checked);
  bind('#setLlmModel', 'llmModel');
  bind('#setGlossary', 'glossary');
  bind('#setInstructions', 'instructions');
  bind('#setHeadphones', 'headphones', checked);
  bind('#setResponsiveness', 'responsiveness');
  bind('#setSpeed', 'speed', (el) => Number(el.value));
  bind('#setMic', 'micDeviceId');
  bind('#setOut', 'outDeviceId');
  bind('#setVoiceMine', 'voiceMine');
  bind('#setVoiceOther', 'voiceOther');
  bind('#setPwaUrl', 'pwaUrl', trimmed);
  bind('#setSttModel', 'sttModel', trimmed);
  bind('#setTtsModel', 'ttsModel', trimmed);
  $('#setSpeed').addEventListener('input', (e) => {
    $('#speedOut').textContent = `${Number(e.target.value).toFixed(2)}×`;
  });
}

// --- kľúče ----------------------------------------------------------------------------

async function checkKeys() {
  const out = $('#keysResult');
  const s = store.all;
  if (!s.sonioxKey) return result(out, 'Zadaj Soniox API kľúč.', 'bad');
  result(out, 'Overujem…');
  const parts = [];
  let ok = true;
  try {
    await rest().check();
    parts.push('Soniox ✓');
  } catch (err) {
    ok = false;
    parts.push(err.message);
  }
  if (s.anthropicKey) {
    try {
      await new Refiner({ apiKey: s.anthropicKey, model: s.llmModel, baseURL: store.endpoints.anthropic }).check();
      parts.push('Anthropic ✓');
    } catch (err) {
      ok = false;
      parts.push(err.message);
    }
  } else parts.push('Anthropic kľúč nie je zadaný – pobeží rýchly preklad.');
  result(out, parts.join('  ·  '), ok ? 'ok' : 'bad');
  if (ok) loadVoices();
}

// --- hlas -------------------------------------------------------------------------------

async function testVoice() {
  const s = store.all;
  if (!s.sonioxKey) return toast('Najprv zadaj Soniox API kľúč.', 'error');
  await deps.prepareAudio();
  const phrase = SAMPLE_PHRASES[s.langB] || SAMPLE_PHRASES.en;
  deps.app.say(phrase, SAMPLE_PHRASES[s.langB] ? s.langB : 'en', voiceFor(s, { mine: true }));
}

function setSample(blob, filename, info) {
  sample = blob ? { blob, filename } : null;
  const audio = $('#voicePreview');
  if (audio.src) URL.revokeObjectURL(audio.src);
  audio.hidden = !blob;
  if (blob) audio.src = URL.createObjectURL(blob);
  else audio.removeAttribute('src');
  result($('#recordInfo'), info || '');
  updateCreateButton();
}

function updateCreateButton() {
  $('#btnCreateVoice').disabled = !(sample && $('#voiceConsent').checked && $('#voiceName').value.trim());
}

async function toggleRecording() {
  const button = $('#btnRecord');
  if (recorder) {
    recorder.finish();
    return;
  }
  const chunks = [];
  const capture = new MicCapture({ targetRate: null }); // plná kvalita, nie 16 kHz
  const started = Date.now();
  let timer = null;
  const finish = async () => {
    clearInterval(timer);
    recorder = null;
    await capture.stop();
    button.textContent = '● Nahrať vzorku';
    button.classList.remove('recording');
    const seconds = Math.round((Date.now() - started) / 1000);
    if (seconds < 10) return setSample(null, '', 'Príliš krátke – nahraj aspoň 10 sekúnd, ideálne 30–60.');
    const wav = encodeWav(chunks, capture.sampleRate);
    setSample(new Blob([wav], { type: 'audio/wav' }), 'vzorka.wav', `Nahraté ${seconds} s. Vypočuj si a vytvor hlas.`);
  };
  try {
    setSample(null, '', '');
    await capture.start({ deviceId: store.all.micDeviceId, onChunk: (pcm) => chunks.push(pcm) });
  } catch (err) {
    return result($('#recordInfo'), err.message, 'bad');
  }
  recorder = { finish };
  button.textContent = '■ Zastaviť nahrávanie';
  button.classList.add('recording');
  timer = setInterval(() => {
    const seconds = Math.round((Date.now() - started) / 1000);
    result($('#recordInfo'), `Nahrávam… ${seconds} s`);
    if (seconds >= MAX_SAMPLE_SECONDS) finish();
  }, 500);
}

async function createVoice() {
  const out = $('#voiceResult');
  const name = $('#voiceName').value.trim();
  const button = $('#btnCreateVoice');
  button.disabled = true;
  result(out, 'Nahrávam vzorku do Soniox…');
  try {
    const api = rest();
    const voice = await api.createVoice(name, sample.blob, sample.filename);
    result(out, 'Hlas sa spracúva…');
    await api.waitVoiceReady(voice.id, store.all.ttsModel);
    await store.update({ voiceMine: voice.id });
    await loadVoices();
    setSample(null, '', '');
    $('#voiceConsent').checked = false;
    result(out, `Hlas „${name}“ je pripravený a vybraný.`, 'ok');
  } catch (err) {
    const duplicate = err.code === 409 ? ' Hlas s týmto názvom už existuje – zvoľ iný názov.' : '';
    result(out, err.message + duplicate, 'bad');
  }
  updateCreateButton();
}

async function deleteVoice() {
  const id = store.all.voiceMine;
  const voice = voices.mine.find((v) => v.id === id);
  if (!voice || !confirm(`Naozaj natrvalo zmazať hlas „${voice.name}“ zo Soniox?`)) return;
  try {
    await rest().deleteVoice(id);
    await store.update({ voiceMine: '' });
    await loadVoices();
    toast('Hlas bol zmazaný.');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// --- prenos do telefónu ---------------------------------------------------------------

function showQr() {
  const box = $('#qrBox');
  const s = store.all;
  let url;
  try {
    url = new URL(s.pwaUrl);
    if (url.protocol !== 'https:') throw new Error('not https');
  } catch {
    box.hidden = true;
    return toast('Zadaj adresu webovej verzie (musí začínať https://).', 'error');
  }
  url.hash = `cfg=${exportConfig(s, { includeKeys: $('#qrKeys').checked })}`;
  const qr = qrcode(0, 'L');
  qr.addData(url.toString());
  try {
    qr.make();
  } catch {
    return toast('Nastavenia sú na QR kód priveľké – skráť slovník alebo použi „Kopírovať nastavenia“.', 'error');
  }
  const note = document.createElement('p');
  note.textContent = $('#qrKeys').checked
    ? 'Naskenuj fotoaparátom telefónu. Kód obsahuje tvoje API kľúče – neukazuj ho nikomu.'
    : 'Naskenuj fotoaparátom telefónu. API kľúče potom zadaj v telefóne ručne.';
  box.replaceChildren(qrSvg(qr), note);
  box.hidden = false;
}

async function copyConfig() {
  const packed = exportConfig(store.all, { includeKeys: $('#qrKeys').checked });
  try {
    await navigator.clipboard.writeText(packed);
    toast('Nastavenia sú v schránke. Vlož ich na druhom zariadení.');
  } catch {
    $('#importText').value = packed;
    toast('Skopíruj text z poľa nižšie.');
  }
}

async function importFromText() {
  try {
    const patch = importConfig($('#importText').value);
    await store.update(patch);
    $('#importText').value = '';
    render();
    loadVoices();
    toast('Nastavenia načítané.');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// --- verejné ----------------------------------------------------------------------------

export function initSettings(dependencies) {
  deps = dependencies;
  bindAll();
  $('#btnCheckKeys').addEventListener('click', checkKeys);
  $('#btnTestVoice').addEventListener('click', testVoice);
  $('#btnReloadVoices').addEventListener('click', loadVoices);
  $('#btnDeleteVoice').addEventListener('click', deleteVoice);
  $('#btnRecord').addEventListener('click', toggleRecording);
  $('#voiceFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) setSample(file, file.name, `Vybraný súbor: ${file.name}`);
    e.target.value = '';
  });
  $('#voiceConsent').addEventListener('change', updateCreateButton);
  $('#voiceName').addEventListener('input', updateCreateButton);
  $('#btnCreateVoice').addEventListener('click', createVoice);
  $('#btnAddLang').addEventListener('click', async () => {
    await openLanguagePicker({ title: 'Pridať jazyk', current: '' });
  });
  $('#btnQr').addEventListener('click', showQr);
  $('#btnCopyConfig').addEventListener('click', copyConfig);
  $('#btnImport').addEventListener('click', importFromText);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target.closest('[data-close]')) dialog.close();
  });
  dialog.addEventListener('close', () => recorder?.finish());
  store.subscribe((settings, changed) => {
    if (!dialog.open) return;
    if (changed.some((k) => ['myLanguages', 'langA', 'langB'].includes(k))) renderMyLanguages();
    if (changed.some((k) => ['voiceMine', 'voiceOther'].includes(k))) renderVoices();
    if (changed.some((k) => ['sonioxKey', 'region', 'ttsModel'].includes(k))) loadVoices();
  });
}

export function openSettings(section) {
  render();
  if (section) {
    for (const details of dialog.querySelectorAll('details')) details.open = details.id === section;
  }
  $('#qrBox').hidden = true;
  dialog.showModal();
  renderDevices();
  loadVoices();
}
