export class Lfo {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.osc = ctx.createOscillator();
    this.osc.type = opts.type || 'sine';
    this.osc.frequency.value = opts.rate || 1;
    this.gain = ctx.createGain();
    this.gain.gain.value = opts.depth || 50;
    this.osc.connect(this.gain);
    this.osc.start();
  }

  connect(dest) {
    this.gain.connect(dest);
  }

  setRate(rate) {
    this.osc.frequency.value = rate;
  }

  setDepth(depth) {
    this.gain.gain.value = depth;
  }

  setType(type) {
    this.osc.type = type;
  }

  dispose() {
    this.osc.stop();
    this.osc.disconnect();
    this.gain.disconnect();
  }
}
