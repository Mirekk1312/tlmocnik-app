// Zvuk v prehliadači: mikrofón → 16-bit PCM a plynulé prehrávanie PCM.
import { Downsampler, floatToInt16, rms } from './core/pcm.js';
import { STT_SAMPLE_RATE, TTS_SAMPLE_RATE } from './core/config.js';

let context = null;

/** Spoločný AudioContext; musí sa prvýkrát zavolať z kliknutia používateľa. */
export async function audioContext() {
  if (!context) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    context = new Ctx({ latencyHint: 'interactive' });
  }
  if (context.state !== 'running') await context.resume().catch(() => {});
  return context;
}

export async function setOutputDevice(deviceId) {
  const ctx = await audioContext();
  if (typeof ctx.setSinkId !== 'function') return false;
  try {
    await ctx.setSinkId(deviceId || '');
    return true;
  } catch {
    return false;
  }
}

export const canPickOutput = () => 'setSinkId' in (window.AudioContext || window.webkitAudioContext).prototype;

export class MicCapture {
  /** targetRate: 16000 pre rozpoznávanie, null = pôvodná kvalita (vzorka hlasu). */
  constructor({ targetRate = STT_SAMPLE_RATE, streamFactory = null } = {}) {
    this.targetRate = targetRate;
    this.streamFactory = streamFactory;
    this.sampleRate = targetRate || 48000;
    this.active = false;
  }

  async start({ deviceId, onChunk, onLevel }) {
    if (this.active) await this.stop();
    const ctx = await audioContext();
    if (this.streamFactory) {
      this.stream = await this.streamFactory(ctx);
    } else {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Tento prehliadač nepovoľuje mikrofón. Otvor aplikáciu cez HTTPS.');
      }
      const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
      if (deviceId) audio.deviceId = { exact: deviceId };
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio });
      } catch (err) {
        if (err.name === 'OverconstrainedError' && deviceId) {
          delete audio.deviceId; // uložený mikrofón už nie je pripojený
          this.stream = await navigator.mediaDevices.getUserMedia({ audio });
        } else if (err.name === 'NotAllowedError') {
          throw new Error('Prístup k mikrofónu je zakázaný. Povoľ ho v nastaveniach prehliadača alebo systému.');
        } else if (err.name === 'NotFoundError') {
          throw new Error('Nenašiel sa žiadny mikrofón.');
        } else throw err;
      }
    }

    const resampler = new Downsampler(ctx.sampleRate, this.targetRate);
    this.sampleRate = resampler.rate;
    const handle = (block) => {
      if (!this.active) return;
      onLevel?.(rms(block));
      const out = resampler.process(block);
      if (out.length) onChunk(floatToInt16(out));
    };

    this.source = ctx.createMediaStreamSource(this.stream);
    this.sink = ctx.createGain();
    this.sink.gain.value = 0; // uzol musí viesť do výstupu, inak ho prehliadač nespracúva
    if (ctx.audioWorklet) {
      await ctx.audioWorklet.addModule(new URL('./mic-worklet.js', import.meta.url));
      this.node = new AudioWorkletNode(ctx, 'mic-tap', { numberOfOutputs: 1, channelCount: 1 });
      this.node.port.onmessage = (event) => handle(event.data);
    } else {
      this.node = ctx.createScriptProcessor(2048, 1, 1);
      this.node.onaudioprocess = (event) => handle(new Float32Array(event.inputBuffer.getChannelData(0)));
    }
    this.source.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(ctx.destination);
    this.active = true;
  }

  async stop() {
    this.active = false;
    try {
      this.source?.disconnect();
      this.node?.disconnect();
      this.sink?.disconnect();
      if (this.node?.port) this.node.port.onmessage = null;
    } catch {
      /* už odpojené */
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.source = this.node = this.sink = this.stream = null;
  }
}

/** Plynulé prehrávanie kúskov PCM tak, ako prichádzajú zo syntézy reči. */
export class PcmPlayer {
  constructor({ sampleRate = TTS_SAMPLE_RATE, tailMs = 300, onChange } = {}) {
    this.sampleRate = sampleRate;
    this.tailMs = tailMs; // dozvuk v miestnosti – mikrofón ešte chvíľu držíme stlmený
    this.onChange = onChange || (() => {});
    this.sources = new Set();
    this.nextTime = 0;
    this.busyUntil = 0;
    this.playing = false;
    this.ctx = null;
  }

  /** True, kým niečo hrá (vrátane krátkeho dozvuku). */
  get busy() {
    return performance.now() < this.busyUntil;
  }

  async prepare() {
    this.ctx = await audioContext();
  }

  enqueue(pcm) {
    const ctx = this.ctx;
    if (!ctx || !pcm.length) return;
    const buffer = ctx.createBuffer(1, pcm.length, this.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] / 32768;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    // Malý náskok na začiatku vety vyrovná kolísanie siete.
    const startAt = Math.max(this.nextTime, ctx.currentTime + (this.sources.size ? 0.02 : 0.08));
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.busyUntil = performance.now() + (this.nextTime - ctx.currentTime) * 1000 + this.tailMs;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (!this.sources.size) this.#setPlaying(false);
    };
    this.#setPlaying(true);
  }

  stop() {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* ešte nezačal */
      }
    }
    this.sources.clear();
    this.nextTime = 0;
    this.busyUntil = 0;
    this.#setPlaying(false);
  }

  #setPlaying(playing) {
    if (playing === this.playing) return;
    this.playing = playing;
    this.onChange(playing);
  }
}

/** Testovací "mikrofón": pípanie s prestávkami (len pre vývoj, ?fakemic=1). */
export function beepStream(ctx) {
  const dest = ctx.createMediaStreamDestination();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 220;
  gain.gain.value = 0;
  osc.connect(gain).connect(dest);
  osc.start();
  const t0 = ctx.currentTime + 0.5;
  for (let i = 0; i < 40; i++) {
    gain.gain.setValueAtTime(0.5, t0 + i * 3.5);
    gain.gain.setValueAtTime(0, t0 + i * 3.5 + 1);
  }
  return dest.stream;
}
