export class Reverb {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.duration = opts.duration || 2.0;
    this.decay = opts.decay || 0.5;
    this.dry = ctx.createGain();
    this.dry.gain.value = opts.dry ?? 0.7;
    this.wet = ctx.createGain();
    this.wet.gain.value = opts.wet ?? 0.3;
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this._createImpulse();
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.dry);
    this.input.connect(this.convolver);
    this.convolver.connect(this.wet);
    this.dry.connect(this.output);
    this.wet.connect(this.output);
  }

  connect(dest) {
    this.output.connect(dest);
  }

  disconnect() {
    this.output.disconnect();
  }

  _createImpulse() {
    const rate = this.ctx.sampleRate;
    const length = rate * this.duration;
    const impulse = this.ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, this.decay);
      }
    }
    return impulse;
  }

  setMix(dry, wet) { this.dry.gain.value = dry; this.wet.gain.value = wet; }
}
