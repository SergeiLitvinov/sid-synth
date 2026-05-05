export class PatternSequencer {
  constructor(ctx) {
    this.ctx = ctx;
    this.patterns = new Map();
    this.currentStep = 0;
    this.steps = 16;
    this.bpm = 120;
    this.isPlaying = false;
    this.timer = null;
    this.onStep = null;
  }

  setPattern(pattern) {
    this.patterns.clear();
    pattern.forEach((note, i) => {
      if (note) this.patterns.set(i, note);
    });
  }

  start() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.currentStep = 0;
    this._tick();
  }

  stop() {
    this.isPlaying = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  _tick() {
    if (!this.isPlaying) return;
    const note = this.patterns.get(this.currentStep);
    if (this.onStep) {
      this.onStep(this.currentStep, note);
    }
    this.currentStep = (this.currentStep + 1) % this.steps;
    const interval = (60 / this.bpm / 4) * 1000;
    this.timer = setTimeout(() => this._tick(), interval);
  }

  setBpm(bpm) {
    this.bpm = bpm;
  }

  dispose() {
    this.stop();
  }
}
