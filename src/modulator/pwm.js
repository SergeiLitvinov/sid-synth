export class Pwm {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.rate = opts.rate || 1;
    this.depth = opts.depth || 0.5;
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = this.rate;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = this.depth;
    this.lfo.connect(this.lfoGain);
    this.lfo.start();
  }

  connectSquareOsc(osc) {
    if (osc && osc.type === 'square') {
      this.lfoGain.connect(osc.frequency);
    }
  }

  setRate(rate) {
    this.lfo.frequency.value = rate;
  }

  setDepth(depth) {
    this.lfoGain.gain.value = depth;
  }

  dispose() {
    this.lfo.stop();
    this.lfo.disconnect();
    this.lfoGain.disconnect();
  }
}
