// Pomocné funkcie pre surový zvuk (PCM).

export function floatToInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function rms(f32) {
  if (!f32.length) return 0;
  let sum = 0;
  for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
  return Math.sqrt(sum / f32.length);
}

/**
 * Priebežné zníženie vzorkovacej frekvencie priemerovaním (stačí pre reč).
 * Ak je vstup pomalší než cieľ, nič nemení – `rate` hovorí, čo naozaj vychádza.
 */
export class Downsampler {
  constructor(inRate, outRate) {
    this.passthrough = !outRate || inRate <= outRate;
    this.rate = this.passthrough ? inRate : outRate;
    this.ratio = inRate / this.rate;
    this.pos = 0;
    this.acc = 0;
    this.n = 0;
  }

  process(input) {
    if (this.passthrough) return input;
    const out = new Float32Array(Math.ceil(input.length / this.ratio) + 1);
    let o = 0;
    for (let i = 0; i < input.length; i++) {
      this.acc += input[i];
      this.n++;
      this.pos++;
      if (this.pos >= this.ratio) {
        out[o++] = this.acc / this.n;
        this.acc = 0;
        this.n = 0;
        this.pos -= this.ratio;
      }
    }
    return out.subarray(0, o);
  }
}

/** Dekóduje base64 kúsky 16-bit PCM; nepárny bajt si prenesie do ďalšieho kúska. */
export class PcmChunkDecoder {
  constructor() {
    this.carry = -1;
  }

  push(b64) {
    const bin = atob(b64);
    const hasCarry = this.carry >= 0;
    const bytes = new Uint8Array(bin.length + (hasCarry ? 1 : 0));
    let o = 0;
    if (hasCarry) bytes[o++] = this.carry;
    for (let i = 0; i < bin.length; i++) bytes[o++] = bin.charCodeAt(i);
    let total = bytes.length;
    this.carry = -1;
    if (total % 2) this.carry = bytes[--total];
    const out = new Int16Array(total / 2);
    const view = new DataView(bytes.buffer, 0, total);
    for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
    return out;
  }
}

/** Zabalí 16-bit mono PCM do WAV súboru. */
export function encodeWav(chunks, sampleRate) {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset, s) => {
    for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples * 2, true);
  let o = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++, o += 2) view.setInt16(o, chunk[i], true);
  }
  return bytes;
}
