// Priebežný parser odpovede jazykového modelu vo formáte
//   <clean>…</clean>\n<translation>…</translation>
// Preklad posiela ďalej po kúskoch hneď, ako prichádza (kvôli rýchlemu
// nábehu syntézy reči), a nikdy nepustí von rozpísanú koncovú značku.

const OPEN_CLEAN = '<clean>';
const CLOSE_CLEAN = '</clean>';
const OPEN_TR = '<translation>';
const CLOSE_TR = '</translation>';

export class TagStreamParser {
  constructor({ onClean, onTranslationDelta } = {}) {
    this.onClean = onClean || (() => {});
    this.onTranslationDelta = onTranslationDelta || (() => {});
    this.reset();
  }

  reset() {
    this.buf = '';
    this.state = 'pre';
    this.clean = null;
    this.translation = '';
  }

  feed(chunk) {
    if (!chunk || this.state === 'done') return;
    this.buf += chunk;
    for (;;) {
      if (this.state === 'pre') {
        const i = this.buf.indexOf(OPEN_CLEAN);
        const j = this.buf.indexOf(OPEN_TR);
        if (j >= 0 && (i < 0 || j < i)) {
          // Model vynechal <clean> – berieme rovno preklad.
          this.buf = this.buf.slice(j + OPEN_TR.length);
          this.state = 'translation';
        } else if (i >= 0) {
          this.buf = this.buf.slice(i + OPEN_CLEAN.length);
          this.state = 'clean';
        } else return;
      } else if (this.state === 'clean') {
        const i = this.buf.indexOf(CLOSE_CLEAN);
        if (i < 0) return;
        this.clean = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + CLOSE_CLEAN.length);
        this.state = 'between';
        this.onClean(this.clean);
      } else if (this.state === 'between') {
        const i = this.buf.indexOf(OPEN_TR);
        if (i < 0) return;
        this.buf = this.buf.slice(i + OPEN_TR.length);
        this.state = 'translation';
      } else if (this.state === 'translation') {
        const i = this.buf.indexOf(CLOSE_TR);
        if (i >= 0) {
          this.#emit(this.buf.slice(0, i).replace(/\s+$/, ''));
          this.buf = '';
          this.state = 'done';
          return;
        }
        const safe = safeLength(this.buf, CLOSE_TR);
        if (safe > 0) {
          this.#emit(this.buf.slice(0, safe));
          this.buf = this.buf.slice(safe);
        }
        return;
      } else return;
    }
  }

  /** Koniec prúdu – dobehne, čo zostalo (napr. keď chýba koncová značka). */
  end() {
    if (this.state === 'translation') {
      const cut = this.buf.lastIndexOf('<');
      const rest = cut >= 0 && CLOSE_TR.startsWith(this.buf.slice(cut)) ? this.buf.slice(0, cut) : this.buf;
      this.#emit(rest.replace(/\s+$/, ''));
    } else if (this.state === 'pre' && this.buf.trim()) {
      // Model nedodržal formát: celý text považujeme za preklad.
      this.#emit(this.buf.trim());
    } else if (this.state === 'clean' && this.clean === null) {
      this.clean = this.buf.trim();
      this.onClean(this.clean);
    }
    this.buf = '';
    this.state = 'done';
  }

  #emit(text) {
    if (!this.translation) text = text.replace(/^\s+/, '');
    if (!text) return;
    this.translation += text;
    this.onTranslationDelta(text);
  }
}

// Dĺžka začiatku `buf`, ktorý je bezpečné pustiť von: zadržíme koncové biele
// znaky a prípadný rozpísaný začiatok koncovej značky.
function safeLength(buf, closeTag) {
  let end = buf.length;
  const max = Math.min(closeTag.length - 1, end);
  for (let k = max; k > 0; k--) {
    if (closeTag.startsWith(buf.slice(end - k))) {
      end -= k;
      break;
    }
  }
  while (end > 0 && /\s/.test(buf[end - 1])) end--;
  return end;
}
