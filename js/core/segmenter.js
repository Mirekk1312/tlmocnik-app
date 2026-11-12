// Skladá prúd tokenov zo Soniox real-time STT do úsekov reči (výpovedí).
//
// Soniox posiela v každej odpovedi: finálne tokeny (raz) a nefinálne tokeny
// (zakaždým celé znova). Prekladové tokeny nasledujú za hovorenými tokenmi,
// ktoré prekladajú, a koniec výpovede označuje token "<end>". Preklad môže
// doraziť pred aj po "<end>", preto ho priraďujeme k poslednému úseku,
// ktorý má finálny hovorený text.

const END_MARKERS = new Set(['<end>', '<fin>']);

export class Segment {
  constructor(id) {
    this.id = id;
    this.source = ''; // finálny hovorený text
    this.sourceTail = ''; // nefinálny (ešte sa môže zmeniť)
    this.translation = '';
    this.translationTail = '';
    this.translationLang = null;
    this.langChars = {};
    this.tailLang = null;
    this.ended = false;
  }

  /** Jazyk, ktorým sa v úseku hovorilo (podľa väčšiny znakov). */
  get sourceLang() {
    let best = null;
    let max = 0;
    for (const [lang, n] of Object.entries(this.langChars)) {
      if (n > max) {
        max = n;
        best = lang;
      }
    }
    return best || this.tailLang;
  }
}

export class Segmenter {
  constructor({ onUpdate, onEnd, onDrop, onTranslation } = {}) {
    this.onUpdate = onUpdate || (() => {});
    this.onEnd = onEnd || (() => {});
    this.onDrop = onDrop || (() => {});
    this.onTranslation = onTranslation || (() => {});
    this.current = null; // úsek, ktorý ešte prijíma hovorený text
    this.lastSpoken = null; // posledný úsek s finálnym hovoreným textom
    this.nextId = 1;
  }

  push(response) {
    const touched = new Set();
    const ended = [];
    let tailSource = '';
    let tailLang = null;
    let tailTranslation = '';

    for (const token of response.tokens || []) {
      const text = token.text;
      if (!text) continue;
      if (END_MARKERS.has(text)) {
        this.#end(ended);
        continue;
      }
      if (token.translation_status === 'translation') {
        if (!token.is_final) {
          tailTranslation += text;
          continue;
        }
        const seg = this.lastSpoken || this.#ensureCurrent();
        seg.translation += text;
        if (token.language) seg.translationLang = token.language;
        touched.add(seg);
        this.onTranslation(seg, text, token);
      } else if (token.is_final) {
        const seg = this.#ensureCurrent();
        seg.source += text;
        if (token.language) {
          seg.langChars[token.language] = (seg.langChars[token.language] || 0) + text.trim().length;
        }
        this.lastSpoken = seg;
        touched.add(seg);
      } else {
        tailSource += text;
        if (token.language) tailLang = token.language;
      }
    }

    if (tailSource) {
      const seg = this.#ensureCurrent();
      if (seg.sourceTail !== tailSource) {
        seg.sourceTail = tailSource;
        seg.tailLang = tailLang;
        touched.add(seg);
      }
    } else if (this.current && this.current.sourceTail) {
      this.current.sourceTail = '';
      touched.add(this.current);
    }

    const target = this.lastSpoken;
    if (target && target.translationTail !== tailTranslation) {
      target.translationTail = tailTranslation;
      touched.add(target);
    }

    if (response.finished) this.#end(ended);

    // Úsek, z ktorého zostal len prázdny chvost (rozpoznávač si to rozmyslel).
    if (this.current && !this.current.source.trim() && !this.current.sourceTail.trim()) {
      touched.delete(this.current);
      this.onDrop(this.current);
      this.current = null;
    }

    for (const seg of touched) if (!ended.includes(seg)) this.onUpdate(seg);
    for (const seg of ended) {
      this.onUpdate(seg);
      this.onEnd(seg);
    }
  }

  /** Ukončí rozpracovaný úsek (napr. pri zastavení alebo výpadku spojenia). */
  flush() {
    const ended = [];
    if (this.current) {
      // Čo nestihlo byť finálne, berieme tak, ako to je.
      this.current.source += this.current.sourceTail;
      this.current.sourceTail = '';
    }
    this.#end(ended);
    for (const seg of ended) {
      this.onUpdate(seg);
      this.onEnd(seg);
    }
  }

  #ensureCurrent() {
    if (!this.current) this.current = new Segment(this.nextId++);
    return this.current;
  }

  #end(ended) {
    const seg = this.current;
    if (!seg) return;
    this.current = null;
    seg.sourceTail = '';
    if (!seg.source.trim()) {
      this.onDrop(seg);
      return;
    }
    seg.ended = true;
    ended.push(seg);
  }
}

const FILLER = /^(e+h*m*|h+m+|m+h*m*|u+h+m*|u+m+|é+|á+|ehm+|hm+|mhm+|no)$/i;

/** Výpoveď bez obsahu: prázdna, samá interpunkcia alebo len výplnkové zvuky. */
export function isNoise(text) {
  const words = (text || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return true;
  if (words.length > 3) return false;
  return words.every((w) => FILLER.test(w));
}
