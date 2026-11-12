// Hlavná obrazovka: prepojenie rozhrania s tlmočníkom.
import { store } from './store.js';
import { Interpreter } from './interpreter.js';
import { SttClient } from './stt-client.js';
import { TtsClient } from './tts-client.js';
import { Refiner } from './refiner.js';
import { MicCapture, PcmPlayer, audioContext, setOutputDevice, beepStream } from './audio.js';
import { describeSonioxError } from './core/errors.js';
import { languageLabel } from './core/languages.js';
import { importConfig } from './core/config.js';
import { $, toast, icon } from './ui/dom.js';
import { openLanguagePicker } from './ui/languages.js';
import { initSettings, openSettings } from './ui/settings.js';

const desktop = globalThis.desktop;
const params = new URLSearchParams(location.search);
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

await store.load();
await importFromLink();

// --- zvuk a služby ------------------------------------------------------------

const player = new PcmPlayer({ onChange: () => renderStatus() });
const mic = new MicCapture({ streamFactory: isLocal && params.has('fakemic') ? beepStream : null });

const tts = new TtsClient({
  getAuth: () => ({ url: store.endpoints.tts, apiKey: store.all.sonioxKey, model: store.all.ttsModel }),
  onAudio: (pcm) => player.enqueue(pcm),
  onError: (err) => toast(describeSonioxError(err), 'error'),
});

let refiner = null;
let refinerKey = '';
function getRefiner() {
  const s = store.all;
  if (!s.smart || !s.anthropicKey) return null;
  const key = `${s.anthropicKey}|${s.llmModel}|${store.mock}`;
  if (key !== refinerKey) {
    refiner = new Refiner({ apiKey: s.anthropicKey, model: s.llmModel, baseURL: store.endpoints.anthropic });
    refinerKey = key;
  }
  return refiner;
}

const app = new Interpreter({
  getSettings: () => store.all,
  createStt: (options) => new SttClient({ url: store.endpoints.stt, apiKey: store.all.sonioxKey, ...options }),
  tts,
  getRefiner,
  mic,
  player,
});

/** Odomkne zvuk (musí prísť z kliknutia) a nastaví výstupné zariadenie. */
async function prepareAudio() {
  await player.prepare();
  if (store.all.outDeviceId) await setOutputDevice(store.all.outDeviceId);
}

// --- ovládanie ----------------------------------------------------------------

let wakeLock = null;
let gated = false;
let busy = 0;

async function toggleListening() {
  if (app.state === 'listening' || app.state === 'connecting') {
    await app.stop();
    return;
  }
  if (app.state !== 'idle') return;
  if (!store.all.sonioxKey) {
    toast('Najprv zadaj Soniox API kľúč v Nastaveniach.', 'error');
    openSettings('secKeys');
    return;
  }
  await prepareAudio();
  await app.start();
}

$('#btnMic').addEventListener('click', toggleListening);
desktop?.onToggle?.(toggleListening);
if (desktop) $('#hotkeyHint').hidden = false;

$('#btnQuiet').addEventListener('click', () => app.silence());

$('#textForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#textInput');
  const text = input.value.trim();
  if (!text) return;
  await prepareAudio();
  app.translateText(text);
  if (getRefiner()) input.value = '';
});

$('#btnSpeak').addEventListener('click', () => {
  const speak = !store.all.speak;
  store.update({ speak });
  if (!speak) app.silence();
});

$('#btnClear').addEventListener('click', () => app.clear());
$('#btnSettings').addEventListener('click', () => openSettings());

$('#btnSwap').addEventListener('click', () => {
  const { langA, langB } = store.all;
  changeLanguages({ langA: langB, langB: langA });
});
$('#btnLangA').addEventListener('click', () => pickLanguage('langA'));
$('#btnLangB').addEventListener('click', () => pickLanguage('langB'));

async function pickLanguage(slot) {
  const other = slot === 'langA' ? 'langB' : 'langA';
  const code = await openLanguagePicker({
    title: slot === 'langA' ? 'Akým jazykom hovorím' : 'Do akého jazyka prekladať',
    current: store.all[slot],
  });
  if (!code) return;
  const patch = { [slot]: code };
  if (code === store.all[other]) patch[other] = store.all[slot]; // rovnaký jazyk na oboch stranách = výmena
  changeLanguages(patch);
}

for (const button of document.querySelectorAll('.modebar button')) {
  button.addEventListener('click', () => changeLanguages({ mode: button.dataset.mode }));
}

/** Zmena jazykov alebo režimu počas počúvania si vyžiada nové spojenie. */
async function changeLanguages(patch) {
  const wasListening = app.state === 'listening';
  if (wasListening) await app.stop();
  await store.update(patch);
  if (wasListening) await app.start();
}

document.addEventListener('keydown', (event) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || document.querySelector('dialog[open]');
  if (event.code === 'Space' && !typing && !event.repeat) {
    event.preventDefault();
    toggleListening();
  }
});

// --- udalosti tlmočníka ---------------------------------------------------------

app.on('state', async (state) => {
  renderStatus();
  if (state === 'listening') {
    try {
      wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      /* nie je k dispozícii */
    }
  } else if (state === 'idle') {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  }
});
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && app.state === 'listening' && !wakeLock) {
    wakeLock = await navigator.wakeLock?.request('screen').catch(() => null);
  }
});

app.on('level', (level) => {
  $('#btnMic').style.setProperty('--level', (1 + Math.min(0.6, level * 6)).toFixed(2));
});
app.on('gate', (value) => {
  gated = value;
  renderStatus();
});
app.on('busy', (count) => {
  busy = count;
  renderStatus();
});
app.on('error', (message) => toast(message, 'error'));

let lastWarning = 0;
app.on('warning', (message) => {
  if (Date.now() - lastWarning < 15000) return; // neopakovať to isté pri každej vete
  lastWarning = Date.now();
  toast(message, 'error');
});

// --- prepis ---------------------------------------------------------------------

const transcript = $('#transcript');
const nodes = new Map();

app.on('item', renderItem);
app.on('item-remove', (id) => {
  nodes.get(id)?.remove();
  nodes.delete(id);
  renderWelcome();
});
app.on('clear', () => {
  for (const node of nodes.values()) node.remove();
  nodes.clear();
  renderWelcome();
});

function renderItem(item) {
  const source = item.clean ?? item.raw;
  const target = item.translation || item.draft;
  if (!source && !target) return;
  let node = nodes.get(item.id);
  if (!node) {
    node = document.createElement('article');
    node.innerHTML = '<div class="src"><span class="lang"></span><span class="text" dir="auto"></span></div><div class="dst"><span class="lang"></span><span class="text" dir="auto"></span></div><div class="note" hidden></div><div class="tools"></div>';
    const tools = node.querySelector('.tools');
    const replay = icon('M4 9v6h4l5 4V5L8 9H4zM16 8.5a5 5 0 0 1 0 7', 'Povedať znova');
    replay.addEventListener('click', async () => {
      await prepareAudio();
      app.replay(item.id);
    });
    const copy = icon('M9 9h10v11H9zM5 15V4h10', 'Kopírovať preklad');
    copy.addEventListener('click', async () => {
      const current = app.items.get(item.id);
      await navigator.clipboard?.writeText(current?.translation || current?.draft || '').catch(() => {});
      toast('Preklad skopírovaný.');
    });
    tools.append(replay, copy);
    nodes.set(item.id, node);
    transcript.append(node);
    renderWelcome();
  }
  const working = item.status === 'pending' || item.status === 'refining';
  const mine = item.sourceLang === store.all.langA;
  node.className = `item ${mine ? 'mine' : 'theirs'} ${item.status === 'live' ? 'live' : ''} ${working ? 'working' : ''} ${item.status === 'failed' ? 'failed' : ''}`;
  node.querySelector('.src .lang').textContent = item.sourceLang || '';
  node.querySelector('.src .text').textContent = source;
  node.querySelector('.dst .lang').textContent = item.targetLang || '';
  node.querySelector('.dst .text').textContent = target;
  node.querySelector('.dst').classList.toggle('draft', !item.translation && item.status !== 'done');
  const note = node.querySelector('.note');
  note.hidden = !item.note;
  note.textContent = item.note;
  node.querySelector('.tools').hidden = !target || item.status === 'live';
  transcript.scrollTop = transcript.scrollHeight;
}

function renderWelcome() {
  const welcome = $('#welcome');
  welcome.hidden = nodes.size > 0;
  if (welcome.hidden) return;
  const s = store.all;
  if (!s.sonioxKey) {
    welcome.innerHTML = '<h2>Vitaj v Tlmočníkovi</h2><ol><li>Vytvor si Soniox API kľúč a vlož ho v Nastaveniach.</li><li>Pridaj Anthropic API kľúč, ak chceš inteligentnú opravu reči.</li><li>V časti „Môj hlas“ nahraj vzorku, aby preklad znel tvojím hlasom.</li></ol><button class="btn primary" type="button" id="btnWelcome">Otvoriť nastavenia</button>';
    $('#btnWelcome').addEventListener('click', () => openSettings('secKeys'));
    return;
  }
  const tips = [];
  if (!s.voiceMine) tips.push('Preklad zatiaľ hovorí vstavaný hlas. Vlastný vytvoríš v Nastaveniach → Môj hlas.');
  if (!getRefiner()) tips.push('Inteligentná oprava reči je vypnutá (chýba Anthropic kľúč alebo je vypnutá v Nastaveniach).');
  welcome.innerHTML = '<h2>Stlač mikrofón a hovor</h2><p></p>';
  welcome.querySelector('p').textContent = [
    s.mode === 'conversation'
      ? `Rozhovor: ${languageLabel(s.langA)} ⇄ ${languageLabel(s.langB)}. Aplikácia sama spozná, kto hovorí.`
      : `Hovor po ${languageLabel(s.langA).toLowerCase()} – preklad zaznie v jazyku ${languageLabel(s.langB).toLowerCase()}.`,
    ...tips,
  ].join(' ');
}

// --- stav -------------------------------------------------------------------------

function renderStatus() {
  const s = store.all;
  const state = app.state;
  const micButton = $('#btnMic');
  const active = state === 'listening' || state === 'connecting';
  micButton.setAttribute('aria-pressed', String(active));
  micButton.setAttribute('aria-label', active ? 'Zastaviť počúvanie' : 'Spustiť počúvanie');
  micButton.dataset.busy = String(state === 'connecting' || state === 'stopping');

  let status = 'Pripravený';
  if (state === 'connecting') status = 'Pripájam sa…';
  else if (state === 'stopping') status = 'Dokončujem…';
  else if (player.playing) status = gated ? 'Hovorím preklad – mikrofón je stlmený' : 'Hovorím preklad…';
  else if (busy) status = 'Opravujem a prekladám…';
  else if (state === 'listening') status = 'Počúvam…';
  $('#status').textContent = status;
  $('#badge').textContent = getRefiner() ? 'inteligentná oprava' : 'rýchly preklad';
  $('#btnQuiet').hidden = !player.playing;

  $('#btnSpeak').setAttribute('aria-pressed', String(s.speak));
  $('#btnLangA span').textContent = languageLabel(s.langA);
  $('#btnLangB span').textContent = languageLabel(s.langB);
  $('#btnLangA small').textContent = s.mode === 'conversation' ? 'Ja' : 'Hovorím';
  $('#btnLangB small').textContent = s.mode === 'conversation' ? 'Partner' : 'Preklad do';
  for (const button of document.querySelectorAll('.modebar button')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === s.mode));
  }
  const input = $('#textInput');
  input.disabled = !getRefiner();
  input.placeholder = input.disabled ? 'Preklad písaného textu vyžaduje Anthropic kľúč' : 'Alebo napíš, čo chceš povedať…';
}

store.subscribe((settings, changed) => {
  if (changed.some((key) => ['sonioxKey', 'region', 'ttsModel'].includes(key))) tts.reset();
  if (changed.includes('outDeviceId')) setOutputDevice(settings.outDeviceId);
  renderStatus();
  renderWelcome();
});

// --- štart ------------------------------------------------------------------------

initSettings({ app, tts, prepareAudio });
renderStatus();
renderWelcome();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/** Nastavenia prenesené QR kódom: adresa#cfg=… */
async function importFromLink() {
  const match = /[#&]cfg=([\w-]+)/.exec(location.hash);
  if (!match) return;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const patch = importConfig(match[1]);
    if (confirm('Načítať nastavenia z odkazu (jazyky, hlas, kľúče)?')) await store.update(patch);
  } catch (err) {
    alert(err.message);
  }
}

if (isLocal) Object.assign(globalThis, { __app: app, __store: store, __audio: audioContext });
