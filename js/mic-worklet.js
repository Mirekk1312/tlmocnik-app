// Beží vo zvukovom vlákne: zbiera vzorky z mikrofónu a po blokoch ich
// posiela hlavnému vláknu. Zámerne bez importov (kvôli starším prehliadačom).
class MicTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.filled++] = channel[i];
        if (this.filled === this.buffer.length) {
          this.port.postMessage(this.buffer.slice(0));
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('mic-tap', MicTap);
