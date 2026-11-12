// Soniox REST API: hlasy (aj klonovanie) a overenie kľúča.
import { ServiceError, describeSonioxError } from './core/errors.js';

export class SonioxRest {
  constructor({ base, apiKey, fetchImpl = (...args) => globalThis.fetch(...args) }) {
    this.base = base;
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async #call(method, path, body) {
    let res;
    try {
      res = await this.fetch(this.base + path, {
        method,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body,
      });
    } catch {
      throw new ServiceError('Nepodarilo sa spojiť so Soniox. Skontroluj internet.', { service: 'soniox' });
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const info = { code: res.status, type: data?.error_type, message: data?.message };
      throw new ServiceError(describeSonioxError(info), { ...info, service: 'soniox' });
    }
    return data;
  }

  /** Overí kľúč (nič nestojí). */
  async check() {
    await this.#call('GET', '/v1/voices?limit=1');
  }

  async #pages(path) {
    const voices = [];
    let cursor = '';
    for (let page = 0; page < 20; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const data = await this.#call('GET', path + (cursor ? `${sep}cursor=${encodeURIComponent(cursor)}` : ''));
      voices.push(...(data?.voices || []));
      cursor = data?.next_page_cursor;
      if (!cursor) break;
    }
    return voices;
  }

  /** Moje naklonované hlasy. */
  listVoices() {
    return this.#pages('/v1/voices');
  }

  /** Vstavané hlasy modelu. */
  listSharedVoices(model) {
    return this.#pages(`/v1/shared-voices?model=${encodeURIComponent(model)}&limit=200`);
  }

  getVoice(id) {
    return this.#call('GET', `/v1/voices/${encodeURIComponent(id)}`);
  }

  deleteVoice(id) {
    return this.#call('DELETE', `/v1/voices/${encodeURIComponent(id)}`);
  }

  createVoice(name, blob, filename = 'vzorka.wav') {
    const form = new FormData();
    form.append('name', name);
    form.append('file', blob, filename);
    return this.#call('POST', '/v1/voices', form);
  }

  /** Počká, kým je hlas spracovaný pre daný model. */
  async waitVoiceReady(id, model, { timeoutMs = 90000, intervalMs = 1500 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const voice = await this.getVoice(id);
      const entry = (voice.models || []).find((m) => m.model === model);
      if (entry?.status === 'ready') return voice;
      if (entry?.status === 'failed') {
        const info = { type: entry.error_type, message: entry.error_message };
        throw new ServiceError(describeSonioxError(info), { ...info, service: 'soniox' });
      }
      if (Date.now() > deadline) throw new ServiceError('Spracovanie hlasu trvá príliš dlho. Skús to neskôr.');
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

export function voiceStatus(voice, model) {
  return (voice.models || []).find((m) => m.model === model)?.status || 'not_computed';
}
