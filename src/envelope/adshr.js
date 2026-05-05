export class Adsr {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.attack = opts.attack ?? 0.05;
    this.decay = opts.decay ?? 0.2;
    this.sustain = opts.sustain ?? 0.6;
    this.release = opts.release ?? 0.25;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
  }

  connect(dest) {
    this.gain.connect(dest);
    return this;
  }

  get output() {
    return this.gain;
  }

  triggerAttack() {
    const t = this.ctx.currentTime;
    const g = this.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1, t + this.attack);
    g.linearRampToValueAtTime(this.sustain, t + this.attack + this.decay);
  }

  triggerRelease() {
    const t = this.ctx.currentTime;
    const g = this.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + this.release);
  }

  setParams(opts) {
    if (opts.attack !== undefined) this.attack = opts.attack;
    if (opts.decay !== undefined) this.decay = opts.decay;
    if (opts.sustain !== undefined) this.sustain = opts.sustain;
    if (opts.release !== undefined) this.release = opts.release;
  }

  dispose() {
    this.gain.disconnect();
  }
}
