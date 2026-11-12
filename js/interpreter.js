// Tlmočník: spája mikrofón, rozpoznávanie, opravu + preklad a hlasový výstup.
//
//   mikrofón → Soniox STT (+ rýchly preklad) → úsek reči
//       inteligentný režim: úsek → Claude (oprava + preklad) → Soniox TTS
//       rýchly režim:       prekladové tokeny Soniox → Soniox TTS
//
// Rýchly preklad zo Soniox beží vždy: v inteligentnom režime slúži ako
// okamžitý náhľad a ako záloha, keď Claude zlyhá.
import { Emitter } from './core/emitter.js';
import { Segmenter, isNoise } from './core/segmenter.js';
import { buildSttConfig, direction, voiceFor } from './core/config.js';
import { describeSonioxError, isRetriable } from './core/errors.js';

const HISTORY = 6;
const MAX_RECONNECTS = 3;
const FAST_END_GRACE_MS = 250;
const DRAFT_WAIT_MS = 1500;

export class Interpreter extends Emitter {
  constructor({ getSettings, createStt, tts, getRefiner, mic, player }) {
    super();
    this.getSettings = getSettings;
    this.createStt = createStt;
    this.tts = tts;
    this.getRefiner = getRefiner;
    this.mic = mic;
    this.player = player;
    this.state = 'idle'; // idle | connecting | listening | stopping
    this.items = new Map();
    this.history = [];
    this.chain = Promise.resolve();
    this.pending = 0;
    this.session = null;
    this.stt = null;
    this.gated = false;
    this.textSeq = 0;
  }

  // --- ovládanie ----------------------------------------------------------------

  async start() {
    if (this.state !== 'idle') return;
    this.#setState('connecting');
    const settings = this.getSettings();
    this.session = { settings, strict: true, reconnects: 0, smart: Boolean(this.getRefiner()) };
    try {
      await this.mic.start({
        deviceId: settings.micDeviceId,
        onChunk: (pcm) => this.#onMic(pcm),
        onLevel: (level) => this.emit('level', level),
      });
      await this.#openStt();
      if (settings.speak) {
        this.tts.hold = true;
        this.tts.warm().catch(() => {});
      }
      this.#setState('listening');
    } catch (err) {
      await this.#teardown();
      this.emit('error', err?.message || String(err));
    }
  }

  async stop() {
    if (this.state !== 'listening' && this.state !== 'connecting') return;
    this.#setState('stopping');
    const stt = this.stt;
    this.stt = null;
    this.draining = stt; // dobiehajúce odpovede ešte spracujeme
    await this.mic.stop().catch(() => {});
    await stt?.finish();
    stt?.close();
    this.draining = null;
    this.segmenter?.flush();
    await this.#teardown();
  }

  /** Okamžite stíchne (zruší rozpracovaný aj čakajúci hlasový výstup). */
  silence() {
    this.tts.cancelAll();
    this.player.stop();
  }

  /** Preloží a povie napísaný text (vyžaduje inteligentný režim). */
  translateText(text) {
    const refiner = this.getRefiner();
    if (!refiner) {
      this.emit('error', 'Na preklad písaného textu treba Anthropic API kľúč a zapnutú inteligentnú opravu.');
      return;
    }
    const settings = this.getSettings();
    const dir = direction(settings, settings.langA);
    const item = this.#newItem(`t${++this.textSeq}`, 'text');
    Object.assign(item, { raw: text.trim(), sourceLang: dir.source, targetLang: dir.target, status: 'pending' });
    this.emit('item', item);
    this.#enqueue(() => this.#refine(item, null, dir, settings, refiner));
  }

  /** Znova povie preklad danej položky. */
  replay(id) {
    const item = this.items.get(id);
    const text = item?.translation || item?.draft;
    if (!text) return;
    const settings = this.getSettings();
    const dir = { source: item.sourceLang, target: item.targetLang, mine: item.sourceLang === settings.langA };
    this.say(text, item.targetLang, voiceFor(settings, dir));
  }

  say(text, lang, voice) {
    const utterance = this.tts.speak({ language: lang, voice, speed: this.getSettings().speed });
    utterance.write(text);
    utterance.end();
    return utterance.done;
  }

  clear() {
    this.items.clear();
    this.history = [];
    this.emit('clear');
  }

  // --- rozpoznávanie ------------------------------------------------------------

  async #openStt() {
    const { settings, strict } = this.session;
    this.segmenter = new Segmenter({
      onUpdate: (seg) => this.#onSegmentUpdate(seg),
      onEnd: (seg) => this.#onSegmentEnd(seg),
      onDrop: (seg) => this.#dropItem(`s${seg.uid}`),
      onTranslation: (seg, text) => this.#onSegmentTranslation(seg, text),
    });
    const stt = this.createStt({
      config: buildSttConfig(settings, { sampleRate: this.mic.sampleRate, strict }),
      onResponse: (res) => {
        if (stt === this.stt || stt === this.draining) this.segmenter.push(res);
      },
      onError: (err) => {
        if (stt === this.stt) this.#onSttError(err);
      },
      onClose: () => {
        if (stt === this.stt) this.#onSttError({ code: 503, message: 'Spojenie so Soniox sa prerušilo.' });
      },
    });
    this.stt = stt;
    await stt.connect();
  }

  #onMic(pcm) {
    if (!this.stt) return;
    // Bez slúchadiel by mikrofón počul vlastný preklad a prekladal ho dokola.
    const gated = !this.session.settings.headphones && this.player.busy;
    if (gated !== this.gated) {
      this.gated = gated;
      this.emit('gate', gated);
    }
    // Ticho namiesto ničoho: prúd si zachová časovanie a spojenie nevyprší.
    this.stt.sendAudio(gated ? new Int16Array(pcm.length) : pcm);
  }

  #onSttError(err) {
    const session = this.session;
    if (!session || this.state === 'stopping') return;
    const strictUnsupported = session.strict && err.code === 400 && /language_hints_strict/.test(err.message || '');
    if (strictUnsupported) session.strict = false;
    else if (!isRetriable(err) || session.reconnects >= MAX_RECONNECTS) {
      this.emit('error', describeSonioxError(err));
      this.#abort();
      return;
    } else session.reconnects++;

    this.stt?.close();
    this.stt = null;
    this.segmenter.flush();
    const delay = strictUnsupported ? 0 : 500 * 2 ** (session.reconnects - 1);
    setTimeout(async () => {
      if (this.session !== session || this.state !== 'listening') return;
      try {
        await this.#openStt();
      } catch (e) {
        this.emit('error', e?.message || String(e));
        this.#abort();
      }
    }, delay);
  }

  async #abort() {
    this.stt?.close();
    this.stt = null;
    await this.mic.stop().catch(() => {});
    this.segmenter?.flush();
    await this.#teardown();
  }

  async #teardown() {
    this.stt?.close();
    this.stt = null;
    await this.mic.stop().catch(() => {});
    this.tts.hold = false;
    this.session = null;
    if (this.gated) {
      this.gated = false;
      this.emit('gate', false);
    }
    this.emit('level', 0);
    this.#setState('idle');
  }

  // --- úseky reči -----------------------------------------------------------------

  #itemFor(seg) {
    // Číslovanie úsekov začína pri každom spojení odznova, preto vlastné ID.
    seg.uid ??= ++this.textSeq;
    const id = `s${seg.uid}`;
    return this.items.get(id) || this.#newItem(id, 'speech');
  }

  #newItem(id, kind) {
    const item = { id, kind, raw: '', clean: null, draft: '', translation: '', status: 'live', note: '' };
    this.items.set(id, item);
    return item;
  }

  #dropItem(id) {
    if (this.items.delete(id)) this.emit('item-remove', id);
  }

  #onSegmentUpdate(seg) {
    const settings = this.session?.settings || this.getSettings();
    const item = this.#itemFor(seg);
    const dir = direction(settings, seg.sourceLang);
    item.raw = (seg.source + seg.sourceTail).trim();
    item.draft = (seg.translation + seg.translationTail).trim();
    item.sourceLang = dir.source;
    item.targetLang = dir.target;
    this.emit('item', item);
  }

  #onSegmentEnd(seg) {
    const session = this.session;
    const settings = session?.settings || this.getSettings();
    const item = this.#itemFor(seg);
    const dir = direction(settings, seg.sourceLang);
    if (isNoise(item.raw)) {
      seg.utterance?.cancel();
      this.#dropItem(item.id);
      return;
    }
    const refiner = session?.smart ? this.getRefiner() : null;
    if (refiner) {
      item.status = 'pending';
      this.emit('item', item);
      this.#enqueue(() => this.#refine(item, seg, dir, settings, refiner));
    } else {
      item.status = 'done';
      this.emit('item', item);
      this.#scheduleFastEnd(seg);
      this.#remember(item);
    }
  }

  // Rýchly režim: prekladové tokeny idú rovno do syntézy reči.
  #onSegmentTranslation(seg, text) {
    const session = this.session;
    if (!session || session.smart || !session.settings.speak) return;
    const settings = session.settings;
    const dir = direction(settings, seg.sourceLang);
    if (!seg.utterance) {
      seg.utterance = this.tts.speak({
        language: seg.translationLang || dir.target,
        voice: voiceFor(settings, dir),
        speed: settings.speed,
      });
    }
    seg.utterance.write(text);
    if (seg.ended) this.#scheduleFastEnd(seg);
  }

  #scheduleFastEnd(seg) {
    clearTimeout(seg.endTimer);
    seg.endTimer = setTimeout(() => {
      seg.utterance?.end();
      seg.utterance = null; // oneskorené tokeny si otvoria pokračovanie
    }, FAST_END_GRACE_MS);
  }

  // --- inteligentná oprava ------------------------------------------------------

  #enqueue(job) {
    this.pending++;
    this.emit('busy', this.pending);
    this.chain = this.chain.then(job).catch((err) => console.error(err)).then(() => {
      this.pending--;
      this.emit('busy', this.pending);
    });
  }

  async #refine(item, seg, dir, settings, refiner) {
    item.status = 'refining';
    this.emit('item', item);
    let utterance = null;
    const speak = (text) => {
      if (!settings.speak) return;
      utterance ??= this.tts.speak({ language: dir.target, voice: voiceFor(settings, dir), speed: settings.speed });
      utterance.write(text);
    };
    try {
      const result = await refiner.refine(
        {
          text: item.raw,
          sourceLang: dir.source,
          targetLang: dir.target,
          history: this.history.slice(-HISTORY),
          glossary: settings.glossary,
          instructions: settings.instructions,
        },
        {
          onClean: (clean) => {
            item.clean = clean;
            this.emit('item', item);
          },
          onTranslationDelta: (delta) => {
            item.translation += delta;
            this.emit('item', item);
            speak(delta);
          },
          onRestart: () => {
            utterance?.cancel();
            utterance = null;
            item.clean = null;
            item.translation = '';
          },
        },
      );
      utterance?.end();
      if (!result.translation.trim()) {
        // Model usúdil, že výpoveď nemala obsah.
        this.#dropItem(item.id);
        return;
      }
      item.clean = result.clean || item.raw;
      item.translation = result.translation;
      item.status = 'done';
      this.#remember(item);
    } catch (err) {
      utterance?.cancel();
      const draft = seg ? await this.#awaitDraft(seg) : '';
      if (draft) {
        item.translation = draft;
        item.note = 'Bez inteligentnej opravy (rýchly preklad).';
        item.status = 'done';
        utterance = null;
        speak(draft);
        utterance?.end();
        this.#remember(item);
      } else {
        item.status = 'failed';
        item.note = err.message;
      }
      this.emit('warning', `Inteligentná oprava zlyhala: ${err.message}`);
    }
    this.emit('item', item);
  }

  /** Rýchly preklad zo Soniox môže doraziť o chvíľu neskôr než koniec vety. */
  async #awaitDraft(seg) {
    const deadline = Date.now() + DRAFT_WAIT_MS;
    while (!seg.translation.trim() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return seg.translation.trim();
  }

  #remember(item) {
    this.history.push({
      sourceLang: item.sourceLang,
      targetLang: item.targetLang,
      clean: item.clean || item.raw,
      translation: item.translation || item.draft,
    });
    if (this.history.length > HISTORY * 2) this.history.splice(0, this.history.length - HISTORY);
  }

  #setState(state) {
    this.state = state;
    this.emit('state', state);
  }
}
