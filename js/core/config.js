// Nastavenia, ich kontrola a zostavenie požiadaviek pre Soniox.
import { isLanguage } from './languages.js';

export const DEFAULTS = Object.freeze({
  region: 'us',
  langA: 'sk', // jazyk, ktorým hovorím ja
  langB: 'en', // jazyk, do ktorého sa prekladá
  myLanguages: ['sk', 'en'],
  mode: 'oneway', // 'oneway' = hovorím len ja | 'conversation' = obojsmerný rozhovor
  smart: true, // inteligentná oprava reči cez Claude
  llmModel: 'claude-opus-5-5',
  voiceMine: '', // ID naklonovaného hlasu alebo meno vstavaného hlasu
  voiceOther: '', // hlas pre opačný smer v rozhovore
  speak: true,
  speed: 1,
  headphones: false, // true = mikrofón sa počas prehrávania nestlmí
  micDeviceId: '',
  outDeviceId: '',
  responsiveness: 'normal',
  glossary: '',
  instructions: '',
  sttModel: 'stt-rt-v6',
  ttsModel: 'tts-rt-v2',
  pwaUrl: '',
});

export const SECRET_KEYS = ['sonioxKey', 'anthropicKey'];
export const DEFAULT_VOICE = 'Adrian';
export const TTS_SAMPLE_RATE = 24000;
export const STT_SAMPLE_RATE = 16000;

export const LLM_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 – najlepšia kvalita' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 – vyvážený' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 – najrýchlejší a najlacnejší' },
];

export const REGIONS = [
  { id: 'us', label: 'USA (predvolené)' },
  { id: 'eu', label: 'Európska únia' },
  { id: 'jp', label: 'Japonsko' },
  { id: 'in', label: 'India' },
];

// Ako dlho čakať, kým sa veta považuje za dopovedanú.
const ENDPOINT_PRESETS = {
  patient: { endpoint_latency_adjustment_level: 0, endpoint_sensitivity: -0.3, max_endpoint_delay_ms: 3000 },
  normal: { endpoint_latency_adjustment_level: 0, endpoint_sensitivity: 0, max_endpoint_delay_ms: 2000 },
  fast: { endpoint_latency_adjustment_level: 2, endpoint_sensitivity: 0.3, max_endpoint_delay_ms: 1500 },
};

/** Adresy Soniox podľa regiónu projektu (alebo testovací server). */
export function endpoints(region, mock) {
  if (mock) {
    return {
      rest: `http://${mock}`,
      stt: `ws://${mock}/transcribe-websocket`,
      tts: `ws://${mock}/tts-websocket`,
      anthropic: `http://${mock}`,
    };
  }
  const r = region && region !== 'us' ? `.${region}` : '';
  return {
    rest: `https://api${r}.soniox.com`,
    stt: `wss://stt-rt${r}.soniox.com/transcribe-websocket`,
    tts: `wss://tts-rt${r}.soniox.com/tts-websocket`,
    anthropic: undefined,
  };
}

/** Zoberie ľubovoľný objekt a vráti platné nastavenia. */
export function sanitize(input) {
  const s = { ...DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  const out = {};
  for (const key of Object.keys(DEFAULTS)) out[key] = s[key];
  for (const key of SECRET_KEYS) if (typeof s[key] === 'string') out[key] = s[key].trim();

  if (!isLanguage(out.langA)) out.langA = DEFAULTS.langA;
  if (!isLanguage(out.langB)) out.langB = DEFAULTS.langB;
  if (out.langA === out.langB) out.langB = out.langA === 'en' ? 'sk' : 'en';
  const langs = Array.isArray(out.myLanguages) ? out.myLanguages.filter(isLanguage) : [];
  out.myLanguages = [...new Set([...langs, out.langA, out.langB])];

  if (!REGIONS.some((r) => r.id === out.region)) out.region = DEFAULTS.region;
  if (!['oneway', 'conversation'].includes(out.mode)) out.mode = DEFAULTS.mode;
  if (!ENDPOINT_PRESETS[out.responsiveness]) out.responsiveness = DEFAULTS.responsiveness;
  if (!LLM_MODELS.some((m) => m.id === out.llmModel)) out.llmModel = DEFAULTS.llmModel;
  out.speed = Math.min(1.3, Math.max(0.7, Number(out.speed) || 1));
  for (const key of ['smart', 'speak', 'headphones']) out[key] = Boolean(out[key]);
  for (const key of ['voiceMine', 'voiceOther', 'micDeviceId', 'outDeviceId', 'glossary', 'instructions', 'pwaUrl']) {
    out[key] = typeof out[key] === 'string' ? out[key] : '';
  }
  out.sttModel = String(out.sttModel || DEFAULTS.sttModel).trim();
  out.ttsModel = String(out.ttsModel || DEFAULTS.ttsModel).trim();
  return out;
}

/**
 * Slovník: jeden výraz na riadok. "výraz" = písať presne takto,
 * "výraz = preklad" = takto to preložiť.
 */
export function parseGlossary(text) {
  const terms = [];
  const translationTerms = [];
  for (const line of (text || '').split(/\r?\n/)) {
    const [source, target] = line.split('=').map((part) => part.trim());
    if (!source) continue;
    terms.push(source);
    if (target) translationTerms.push({ source, target });
  }
  return { terms: [...new Set(terms)], translationTerms };
}

export function buildSttConfig(s, { sampleRate, strict = true }) {
  const conversation = s.mode === 'conversation';
  const config = {
    model: s.sttModel,
    audio_format: 'pcm_s16le',
    sample_rate: sampleRate,
    num_channels: 1,
    language_hints: conversation ? [s.langA, s.langB] : [s.langA],
    enable_language_identification: true,
    enable_endpoint_detection: true,
    ...ENDPOINT_PRESETS[s.responsiveness],
    translation: conversation
      ? { type: 'two_way', language_a: s.langA, language_b: s.langB }
      : { type: 'one_way', target_language: s.langB },
  };
  if (strict) config.language_hints_strict = true;

  const { terms, translationTerms } = parseGlossary(s.glossary);
  const context = { general: [{ key: 'setting', value: 'live interpreting of spontaneous speech' }] };
  if (terms.length) context.terms = terms;
  if (translationTerms.length) context.translation_terms = translationTerms;
  config.context = context;
  return config;
}

/** Smer prekladu pre danú výpoveď. `mine` = hovoril majiteľ aplikácie. */
export function direction(s, spokenLang) {
  if (s.mode === 'conversation' && spokenLang === s.langB) {
    return { source: s.langB, target: s.langA, mine: false };
  }
  return { source: s.langA, target: s.langB, mine: true };
}

export function voiceFor(s, dir) {
  return (dir.mine ? s.voiceMine : s.voiceOther || s.voiceMine) || DEFAULT_VOICE;
}

// --- Prenos nastavení medzi zariadeniami -----------------------------------

const b64url = {
  encode(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(data) {
    const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  },
};

const DEVICE_ONLY = ['micDeviceId', 'outDeviceId'];

export function exportConfig(all, { includeKeys = false } = {}) {
  const data = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (!DEVICE_ONLY.includes(key) && JSON.stringify(all[key]) !== JSON.stringify(DEFAULTS[key])) data[key] = all[key];
  }
  if (includeKeys) for (const key of SECRET_KEYS) if (all[key]) data[key] = all[key];
  return b64url.encode(JSON.stringify(data));
}

/** Vráti len polia, ktoré balík naozaj obsahuje (už skontrolované). */
export function importConfig(packed) {
  let raw;
  try {
    raw = JSON.parse(b64url.decode(String(packed).trim()));
  } catch {
    try {
      raw = JSON.parse(String(packed));
    } catch {
      throw new Error('Toto nie sú platné nastavenia.');
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Toto nie sú platné nastavenia.');
  const clean = sanitize(raw);
  const patch = {};
  for (const key of [...Object.keys(DEFAULTS), ...SECRET_KEYS]) {
    if (key in raw && !DEVICE_ONLY.includes(key) && clean[key] !== undefined) patch[key] = clean[key];
  }
  if ('langA' in raw || 'langB' in raw) patch.myLanguages = clean.myLanguages;
  return patch;
}
