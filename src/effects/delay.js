export class Delay {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.delay = ctx.createDelay(2.0);
    this.delay.delayTime.value = opts.time || 0.3;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = opts.feedback || 0.4;
    this.dry = ctx.createGain();
    this.dry.gain.value = opts.dry ?? 0.7;
    this.wet = ctx.createGain();
    this.wet.gain.value = opts.wet ?? 0.3;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.dry);
    this.input.connect(this.delay);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.wet);
    this.dry.connect(this.output);
    this.wet.connect(this.output);
  }

  connect(dest) {
    this.output.connect(dest);
  }

  disconnect() {
    this.output.disconnect();
  }

  setTime(time) { this.delay.delayTime.value = time; }
  setFeedback(fb) { this.feedback.gain.value = fb; }
  setMix(dry, wet) { this.dry.gain.value = dry; this.wet.gain.value = wet; }
}
