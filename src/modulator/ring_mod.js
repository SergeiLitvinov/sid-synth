export class RingMod {
  constructor(ctx) {
    this.ctx = ctx;
    this.multiplier = ctx.createGain();
    this.multiplier.gain.value = 0;
    this.carrier = null;
    this.modulator = null;
  }

  connect(carrier, modulator) {
    this.carrier = carrier;
    this.modulator = modulator;
    const merger = this.ctx.createGain();
    carrier.connect(merger);
    modulator.connect(this.multiplier);
    this.multiplier.connect(merger.gain);
    return merger;
  }

  setMix(mix) {
    this.multiplier.gain.value = mix;
  }

  dispose() {
    this.multiplier.disconnect();
  }
}
