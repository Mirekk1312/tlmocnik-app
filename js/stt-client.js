// Klient pre Soniox real-time rozpoznávanie reči (WebSocket).
// Prehliadač nevie poslať hlavičku Authorization, kľúč preto ide v zozname
// protokolov: ['soniox-api-key', kľúč].

const MAX_BACKLOG = 80; // ~3 s zvuku, kým sa spojenie otvorí

export class SttClient {
  constructor({ url, apiKey, config, onResponse, onError, onClose, WebSocketImpl = globalThis.WebSocket }) {
    this.url = url;
    this.apiKey = apiKey;
    this.config = config;
    this.onResponse = onResponse;
    this.onError = onError;
    this.onClose = onClose || (() => {});
    this.WS = WebSocketImpl;
    this.ws = null;
    this.open = false;
    this.backlog = [];
    this.settled = false; // skončilo chybou, riadnym koncom alebo sme zavreli my
    this.finishWaiter = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new this.WS(this.url, ['soniox-api-key', this.apiKey]);
      } catch (err) {
        reject(err);
        return;
      }
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        ws.send(JSON.stringify(this.config));
        this.open = true;
        for (const chunk of this.backlog) ws.send(chunk);
        this.backlog = [];
        resolve();
      };
      ws.onmessage = (event) => {
        let res;
        try {
          res = JSON.parse(event.data);
        } catch {
          return;
        }
        if (res.error_code) {
          this.settled = true;
          this.onError({ code: res.error_code, type: res.error_type, message: res.error_message });
          return;
        }
        this.onResponse(res);
        if (res.finished) {
          this.settled = true;
          this.finishWaiter?.();
        }
      };
      ws.onerror = () => {
        if (!this.open) reject(new Error('Nepodarilo sa pripojiť k Soniox. Skontroluj internet.'));
      };
      ws.onclose = () => {
        const unexpected = this.open && !this.settled;
        this.open = false;
        this.finishWaiter?.();
        if (unexpected) this.onClose();
      };
    });
  }

  sendAudio(pcm) {
    if (this.open) this.ws.send(pcm);
    else if (!this.settled && this.backlog.length < MAX_BACKLOG) this.backlog.push(pcm);
  }

  /** Ohlási koniec zvuku a počká, kým server pošle zvyšok prepisu. */
  finish(timeoutMs = 2500) {
    if (!this.open) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.finishWaiter = () => {
        clearTimeout(timer);
        resolve();
      };
      this.ws.send('');
    });
  }

  close() {
    this.settled = true;
    this.backlog = [];
    try {
      this.ws?.close(1000);
    } catch {
      /* už zavreté */
    }
  }
}
