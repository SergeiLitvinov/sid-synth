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
    // Shared-transport follow mode (P0: rack sequencer on the unified transport).
    // Null = standalone (own PLAY/STOP + local BPM). Attached = transport is master
    // for start/stop/position/tempo; the local scheduler only renders the timeline.
    this.transport = null;
    this._disposed = false;
    // Set by onLoopWrap: transport emits the wrap BEFORE publishing the new
    // position, so the region-start step can only be read from the next onTick.
    this._wrapPending = false;
  }

  setPattern(pattern) {
    this.patterns.clear();
    pattern.forEach((note, i) => {
      if (note) this.patterns.set(i, note);
    });
  }

  get stepDuration() {
    // While following, tempo is live from the shared transport so project BPM
    // changes apply mid-play. Standalone falls back to the local BPM input.
    const bpm = this.transport ? this.transport.getState().bpm : this.bpm;
    return 60 / bpm / 4;
  }

  // -- shared-transport follow -------------------------------------------------
  // Subscribes to the unified transport. All handlers are no-ops after dispose()
  // (transport offers no unsubscribe; the flag guards dead components).
  attachTransport(transport) {
    if (this.transport === transport) return;
    this.transport = transport;
    if (!transport) return;
    transport.onStart(() => {
      if (this._disposed) return;
      this._wrapPending = false;
      this._followPosition();
      this._beginInterval();
    });
    transport.onStop(() => {
      if (this._disposed) return;
      this._wrapPending = false;
      this._endInterval();
      this.currentStep = 0;
    });
    transport.onPause(() => {
      if (this._disposed) return;
      this._endInterval(); // keep currentStep; resume re-anchors the clock
    });
    transport.onResume(() => {
      if (this._disposed) return;
      this.nextTime = this.ctx.currentTime + 0.05;
      this._beginInterval();
    });
    transport.onSeek(() => {
      if (this._disposed) return;
      this._wrapPending = false;
      this._followPosition();
      if (this.isPlaying) this.nextTime = this.ctx.currentTime + 0.05;
    });
    transport.onLoopWrap(() => {
      if (this._disposed) return;
      this._wrapPending = true; // exact step arrives with the next onTick
      if (this.isPlaying) this.nextTime = this.ctx.currentTime + 0.02;
    });
    // Gross-drift guard: the local setInterval clock wanders against the
    // transport over minutes. Snap only when off by 2+ steps so the normal
    // <1-step lookahead never fights the boundary. A pending wrap snaps
    // exactly to the fresh region-start step instead.
    transport.onTick(({ step }) => {
      if (this._disposed || !this.isPlaying || step === undefined) return;
      const want = step % this.steps;
      if (this._wrapPending) {
        this.currentStep = want;
        this._wrapPending = false;
        return;
      }
      const ahead = (want - this.currentStep + this.steps) % this.steps;
      if (ahead >= 2) {
        this.currentStep = want;
        this.nextTime = this.ctx.currentTime + 0.02;
      }
    });
  }

  detachTransport() {
    this.transport = null;
  }

  // Snap the next step to the transport cursor (start / seek / wrap).
  _followPosition() {
    if (!this.transport) return;
    this.currentStep = this.transport.getState().step % this.steps;
    this.nextTime = this.ctx.currentTime + 0.05;
  }

  _beginInterval() {
    this.isPlaying = true;
    if (!this.timer) this.timer = setInterval(() => this._schedule(), this.lookaheadMs);
  }

  _endInterval() {
    this.isPlaying = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  start() {
    if (this.isPlaying) return;
    this._followPosition(); // snap step when following; no-op standalone
    this.nextTime = this.ctx.currentTime + 0.1;
    this._beginInterval();
  }

  stop() {
    this._endInterval();
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
    this._disposed = true;
    this.detachTransport();
    this.stop();
  }
}