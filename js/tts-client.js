// Klient pre Soniox real-time syntézu reči (WebSocket).
// Na jednom spojení beží vždy jeden prúd; ďalšie čakajú v poradí, takže zvuk
// vychádza presne v poradí, v akom boli vety povedané.
import { PcmChunkDecoder } from './core/pcm.js';
import { TTS_SAMPLE_RATE } from './core/config.js';

const IDLE_FLUSH_MS = 1200; // server zruší prúd, do ktorého pár sekúnd nepríde text
const KEEPALIVE_MS = 20000;
const IDLE_CLOSE_MS = 120000;
const STUCK_MS = 15000;

export class TtsClient {
  #ws = null;
  #connecting = null;
  #queue = [];
  #active = null;
  #seq = 0;
  #timer = null;
  #lastUse = 0;

  constructor({ getAuth, onAudio, onError, WebSocketImpl = globalThis.WebSocket }) {
    this.getAuth = getAuth; // () => { url, apiKey, model }
    this.onAudio = onAudio;
    this.onError = onError || (() => {});
    this.WS = WebSocketImpl;
    this.hold = false; // true = spojenie nezatvárať pri nečinnosti
  }

  /** Otvorí spojenie vopred, aby prvá veta nečakala na jeho nadviazanie. */
  warm() {
    return this.#connect();
  }

  /** Začne novú vetu. Text sa posiela cez write(), koniec cez end(). */
  speak(cfg) {
    return new Utterance(this, cfg);
  }

  cancelAll() {
    for (const stream of this.#queue) stream.finish();
    this.#queue = [];
    if (this.#active) this._cancel(this.#active);
  }

  /** Zavrie spojenie (napr. po zmene kľúča alebo regiónu). */
  reset() {
    this.cancelAll();
    this.#closeSocket();
  }

  // --- volané z Utterance ---------------------------------------------------

  _open(cfg, front) {
    const stream = new Stream(`s${++this.#seq}`, cfg);
    if (front) this.#queue.unshift(stream);
    else this.#queue.push(stream);
    this.#lastUse = Date.now();
    this.#connect().then(
      () => this.#pump(),
      (err) => {
        this.#failAll();
        this.onError({ message: err.message });
      },
    );
    return stream;
  }

  _write(stream, text) {
    stream.lastWrite = Date.now();
    if (stream.started) this.#send({ stream_id: stream.id, text, text_end: false });
    else stream.pending.push(text);
  }

  _closeText(stream) {
    if (stream.textClosed) return;
    stream.textClosed = true;
    stream.closedAt = Date.now();
    if (stream.started) this.#send({ stream_id: stream.id, text: '', text_end: true });
  }

  _cancel(stream) {
    if (stream.done) return;
    stream.cancelled = true;
    if (stream === this.#active) {
      stream.textClosed = true;
      stream.closedAt = Date.now();
      this.#send({ stream_id: stream.id, cancel: true });
    } else {
      this.#queue = this.#queue.filter((s) => s !== stream);
      stream.finish();
    }
  }

  // --- spojenie ---------------------------------------------------------------

  #connect() {
    if (this.#ws) return Promise.resolve();
    if (this.#connecting) return this.#connecting;
    this.#connecting = new Promise((resolve, reject) => {
      const { url, apiKey } = this.getAuth();
      let ws;
      try {
        ws = new this.WS(url, ['soniox-api-key', apiKey]);
      } catch (err) {
        this.#connecting = null;
        reject(err);
        return;
      }
      let opened = false;
      ws.onopen = () => {
        opened = true;
        this.#ws = ws;
        this.#connecting = null;
        this.#lastUse = Date.now();
        this.#timer = setInterval(() => this.#tick(), 400);
        resolve();
      };
      ws.onmessage = (event) => this.#onMessage(event);
      ws.onerror = () => {};
      ws.onclose = () => {
        if (!opened) {
          this.#connecting = null;
          reject(new Error('Nepodarilo sa pripojiť k hlasovému výstupu Soniox.'));
          return;
        }
        if (this.#ws === ws) {
          this.#ws = null;
          clearInterval(this.#timer);
          this.#failAll();
        }
      };
    });
    return this.#connecting;
  }

  #closeSocket() {
    const ws = this.#ws;
    this.#ws = null;
    clearInterval(this.#timer);
    try {
      ws?.close(1000);
    } catch {
      /* už zavreté */
    }
  }

  #send(message) {
    if (this.#ws?.readyState === 1) this.#ws.send(JSON.stringify(message));
  }

  #pump() {
    while (!this.#active && this.#queue.length && this.#ws) {
      const stream = this.#queue.shift();
      if (stream.cancelled || (stream.textClosed && !stream.pending.length)) {
        stream.finish();
        continue;
      }
      this.#active = stream;
      stream.started = true;
      stream.lastWrite = Date.now();
      const { model } = this.getAuth();
      const { language, voice, speed } = stream.cfg;
      const config = {
        stream_id: stream.id,
        model,
        language,
        voice,
        audio_format: 'pcm_s16le',
        sample_rate: TTS_SAMPLE_RATE,
      };
      if (speed && speed !== 1) config.speed = speed;
      this.#send(config);
      const text = stream.pending.join('');
      stream.pending = [];
      if (text || stream.textClosed) this.#send({ stream_id: stream.id, text, text_end: stream.textClosed });
    }
  }

  #onMessage(event) {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    const stream = this.#active && msg.stream_id === this.#active.id ? this.#active : null;
    if (msg.error_code) {
      this.onError({ code: msg.error_code, type: msg.error_type, message: msg.error_message });
      if (stream) stream.cancelled = true;
    }
    if (msg.audio && stream && !stream.cancelled) {
      const pcm = stream.decoder.push(msg.audio);
      if (pcm.length) this.onAudio(pcm);
    }
    if (msg.terminated && stream) this.#release(stream);
  }

  #release(stream) {
    this.#active = null;
    this.#lastUse = Date.now();
    stream.finish();
    this.#pump();
  }

  #failAll() {
    const streams = [this.#active, ...this.#queue].filter(Boolean);
    this.#active = null;
    this.#queue = [];
    for (const stream of streams) stream.finish();
  }

  #tick() {
    const now = Date.now();
    const stream = this.#active;
    if (stream) {
      // Dlhá pauza uprostred vety: prúd uzavrieme sami, pokračovanie pôjde novým.
      if (!stream.textClosed && now - stream.lastWrite > IDLE_FLUSH_MS) this._closeText(stream);
      // Server neohlásil koniec prúdu – neblokujeme ďalšie vety.
      else if (stream.textClosed && now - stream.closedAt > STUCK_MS) this.#release(stream);
      this.#lastUse = now;
      return;
    }
    if (!this.hold && !this.#queue.length && now - this.#lastUse > IDLE_CLOSE_MS) {
      this.#closeSocket();
    } else if (now - (this.lastPing || 0) > KEEPALIVE_MS) {
      this.lastPing = now;
      this.#send({ keep_alive: true });
    }
  }
}

class Stream {
  constructor(id, cfg) {
    this.id = id;
    this.cfg = cfg;
    this.pending = [];
    this.started = false;
    this.textClosed = false;
    this.cancelled = false;
    this.done = false;
    this.lastWrite = Date.now();
    this.closedAt = 0;
    this.decoder = new PcmChunkDecoder();
    this.onDone = null;
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.onDone?.();
  }
}

/** Jedna vyslovená veta; pri dlhej pauze sa môže rozložiť na viac prúdov. */
class Utterance {
  #client;
  #cfg;
  #stream = null;
  #openStreams = 0;
  #finished = false;
  #resolve;

  constructor(client, cfg) {
    this.#client = client;
    this.#cfg = cfg;
    this.done = new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  write(text) {
    if (!text || this.#finished) return;
    if (!this.#stream || this.#stream.textClosed) {
      const continuation = this.#stream !== null;
      const stream = this.#client._open(this.#cfg, continuation);
      this.#openStreams++;
      stream.onDone = () => {
        this.#openStreams--;
        this.#settle();
      };
      this.#stream = stream;
    }
    this.#client._write(this.#stream, text);
  }

  end() {
    if (this.#finished) return;
    this.#finished = true;
    if (this.#stream) this.#client._closeText(this.#stream);
    this.#settle();
  }

  cancel() {
    this.#finished = true;
    if (this.#stream) this.#client._cancel(this.#stream);
    this.#settle();
  }

  #settle() {
    if (this.#finished && this.#openStreams <= 0) this.#resolve();
  }
}
