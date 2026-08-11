export class PatternSequencer {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.patterns = new Map();
    this.currentStep = 0;
    this.steps = opts.steps || 16;
    this.bpm = opts.bpm || 120;
    this.isPlaying = false;
    this.lookaheadMs = 25;
    this.nextTime = 0;
    this.timer = null;
    this.onStep = null;
  }

  setPattern(pattern) {
    this.patterns.clear();
    pattern.forEach((note, i) => {
      if (note) this.patterns.set(i, note);
    });
  }

  get stepDuration() {
    return 60 / this.bpm / 4;
  }

  start() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this._schedule(), this.lookaheadMs);
  }

  stop() {
    this.isPlaying = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  _schedule() {
    if (!this.isPlaying) return;
    const horizon = this.ctx.currentTime + this.lookaheadMs / 1000;
    const dur = this.stepDuration;
    while (this.nextTime < horizon) {
      const step = this.currentStep % this.steps;
      const note = this.patterns.get(step);
      if (this.onStep) this.onStep(step, note, this.nextTime, dur);
      this.currentStep = (this.currentStep + 1) % this.steps;
      this.nextTime += dur;
    }
  }

  setBpm(bpm) {
    this.bpm = bpm;
  }

  dispose() {
    this.stop();
  }
}