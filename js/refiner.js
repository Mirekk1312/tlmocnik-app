// Inteligentná oprava reči + preklad cez Claude (oficiálne Anthropic SDK).
// Volá sa priamo zo zariadenia s kľúčom používateľa, preto dangerouslyAllowBrowser.
import Anthropic from '../vendor/anthropic-sdk.js';
import { SYSTEM_PROMPT, buildUserMessage } from './core/prompt.js';
import { TagStreamParser } from './core/tag-parser.js';
import { ServiceError } from './core/errors.js';

// Modely, pri ktorých API vie po odmietnutí samo prejsť na záložný model.
const SERVER_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

export class Refiner {
  constructor({ apiKey, model, baseURL }) {
    this.model = model;
    this.client = new Anthropic({
      apiKey,
      baseURL,
      dangerouslyAllowBrowser: true,
      maxRetries: 1,
      timeout: 30_000,
    });
  }

  /** Overí kľúč bez spotreby tokenov. */
  async check() {
    try {
      await this.client.models.retrieve(this.model);
    } catch (err) {
      throw translate(err);
    }
  }

  /**
   * Opraví a preloží jednu výpoveď. Opravený text hlási cez onClean,
   * preklad priebežne cez onTranslationDelta. Ak záložný model začne
   * odpoveď odznova, zavolá sa onRestart.
   */
  async refine(input, { onClean, onTranslationDelta, onRestart } = {}) {
    const parser = new TagStreamParser({ onClean, onTranslationDelta });
    const params = {
      model: this.model,
      max_tokens: 8000,
      // Krátke vety naživo: plytké uvažovanie stačí a šetrí čas.
      output_config: { effort: 'low' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(input) }],
    };
    try {
      const stream = SERVER_FALLBACK.has(this.model)
        ? this.client.beta.messages.stream({
            ...params,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          })
        : this.client.messages.stream(params);
      stream.on('streamEvent', (event) => {
        if (event.type === 'content_block_start' && event.content_block.type === 'fallback') {
          parser.reset();
          onRestart?.();
        }
      });
      stream.on('text', (delta) => parser.feed(delta));
      const message = await stream.finalMessage();
      parser.end();
      if (message.stop_reason === 'refusal') {
        throw new ServiceError('Claude túto vetu odmietol spracovať.', { type: 'refusal', service: 'anthropic' });
      }
      return { clean: parser.clean ?? '', translation: parser.translation };
    } catch (err) {
      throw translate(err);
    }
  }
}

function translate(err) {
  if (err instanceof ServiceError) return err;
  const opts = { code: err?.status || 0, service: 'anthropic' };
  if (err instanceof Anthropic.AuthenticationError) {
    return new ServiceError('Anthropic API kľúč je neplatný. Skontroluj ho v Nastaveniach.', opts);
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new ServiceError('Anthropic API kľúč nemá prístup k zvolenému modelu.', opts);
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new ServiceError('Zvolený model Claude nie je pre tento kľúč dostupný.', opts);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ServiceError('Claude je práve preťažený požiadavkami (limit). Skús to o chvíľu.', opts);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ServiceError('Nepodarilo sa spojiť s Claude. Skontroluj internet.', opts);
  }
  if (err instanceof Anthropic.APIError) {
    return new ServiceError(`Claude: ${err.message}`, opts);
  }
  return new ServiceError(err?.message || String(err), opts);
}
