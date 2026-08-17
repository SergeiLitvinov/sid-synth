// Unified PPQ-based transport. Owns the clock, the lookahead timer and the
// musical position (ticks); subsystems (step engine, future MIDI clips,
// arranger playhead) subscribe as schedulers or tick listeners.
// Pure enough to unit-test in the browser with an injected clock.

import { createTempoMap, tempoAt, addTempo, ticksToSeconds, secondsToTicks } from './tempoMap.js';

export function createTransport(cfg = {}) {
  const tempoMap = cfg.tempoMap || createTempoMap({
    ppq: cfg.ppq,
    bpm: cfg.bpm,
    num: cfg.num,
    den: cfg.den,
  });
  const t = {
    ctx: cfg.ctx || null,
    tempoMap,
    ppq: tempoMap.ppq,
    playing: false,
    recording: false,
    loopLenTicks: cfg.loopLenTicks !== undefined ? cfg.loopLenTicks : 4 * tempoMap.ppq,
    lookahead: cfg.lookahead !== undefined ? cfg.lookahead : 0.12,
    timerMs: cfg.timerMs !== undefined ? cfg.timerMs : 25,
    _nowMs: cfg.nowMs || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now())),
    _timer: null,
    _startMs: 0,
    _playStartCtx: 0,
    _loopPosTicks: 0,
    _loopCount: 0,
    _schedulers: [],
    _onStart: [],
    _onStop: [],
    _onTick: [],
    _onLoopWrap: [],
    _onStateChange: [],
  };

  Object.defineProperty(t, 'bpm', {
    get() { return tempoAt(tempoMap, t._loopPosTicks); },
    set(v) { addTempo(tempoMap, 0, v); },
  });

  function emit(list, ...args) {
    for (const fn of list) {
      try { fn(...args); } catch (e) {}
    }
  }

  function emitState() {
    emit(t._onStateChange, t.getState());
  }

  function _resume() {
    if (t.ctx && t.ctx.state === 'suspended') {
      try { t.ctx.resume(); } catch (e) {}
    }
  }

  // One timer pass: compute elapsed, advance loop, run schedulers with an
  // absolute audio-time window, then notify tick listeners.
  function _tick() {
    const elapsed = (t._nowMs() - t._startMs) / 1000;
    const nowAbs = t._playStartCtx + elapsed;
    const endAbs = nowAbs + t.lookahead;
    const totalTicks = secondsToTicks(tempoMap, elapsed);
    const loop = Math.floor(totalTicks / t.loopLenTicks);
    if (loop > t._loopCount) {
      t._loopCount = loop;
      emit(t._onLoopWrap, t._loopCount);
    }
    t._loopPosTicks = totalTicks - loop * t.loopLenTicks;
    for (const s of t._schedulers) s(nowAbs, endAbs, {
      elapsed,
      loopPosTicks: t._loopPosTicks,
      loopCount: loop,
    });
    emit(t._onTick, {
      loopPosTicks: t._loopPosTicks,
      loopPosSec: ticksToSeconds(tempoMap, t._loopPosTicks),
      step: Math.floor(t._loopPosTicks / (t.ppq / 4)) % 16,
      loopCount: loop,
      playing: true,
    });
  }

  t.getState = () => ({
    playing: t.playing,
    recording: t.recording,
    bpm: t.bpm,
    ppq: t.ppq,
    loopPosTicks: t._loopPosTicks,
    loopPosSec: ticksToSeconds(tempoMap, t._loopPosTicks),
    step: Math.floor(t._loopPosTicks / (t.ppq / 4)) % 16,
    loopCount: t._loopCount,
    loopLenTicks: t.loopLenTicks,
  });

  t.play = () => {
    if (t.playing) return;
    _resume();
    t._startMs = t._nowMs();
    t._playStartCtx = (t.ctx ? t.ctx.currentTime : 0) + 0.03;
    t._loopPosTicks = 0;
    t._loopCount = 0;
    t.playing = true;
    emit(t._onStart);
    emitState();
    _tick();
    t._timer = setInterval(_tick, t.timerMs);
  };

  t.record = () => {
    t.recording = true;
    emitState();
    if (!t.playing) t.play();
  };

  t.stop = () => {
    if (t._timer) { clearInterval(t._timer); t._timer = null; }
    t.playing = false;
    t.recording = false;
    t._loopPosTicks = 0;
    t._loopCount = 0;
    emit(t._onStop);
    emitState();
  };

  t.setBpm = (v) => { t.bpm = v; emitState(); };

  // Seek the playhead to an absolute tick (markers, navigation). Works stopped
  // (just moves the position) and while playing (rebases the clock so the
  // position stays put under the running timer).
  t.seek = (tick) => {
    const pos = Math.max(0, Math.round(tick));
    t._loopPosTicks = pos % t.loopLenTicks;
    t._loopCount = Math.floor(pos / t.loopLenTicks);
    if (t.playing) {
      const sec = ticksToSeconds(tempoMap, pos);
      t._startMs = t._nowMs() - sec * 1000;
      t._playStartCtx = (t.ctx ? t.ctx.currentTime : 0) + 0.03;
    }
    emit(t._onTick, {
      loopPosTicks: t._loopPosTicks,
      loopPosSec: ticksToSeconds(tempoMap, t._loopPosTicks),
      step: Math.floor(t._loopPosTicks / (t.ppq / 4)) % 16,
      loopCount: t._loopCount,
      playing: t.playing,
    });
    emitState();
  };

  t.addScheduler = (fn) => {
    t._schedulers.push(fn);
    return () => { t._schedulers = t._schedulers.filter(s => s !== fn); };
  };

  t.onStart = (fn) => { t._onStart.push(fn); };
  t.onStop = (fn) => { t._onStop.push(fn); };
  t.onTick = (fn) => { t._onTick.push(fn); };
  t.onLoopWrap = (fn) => { t._onLoopWrap.push(fn); };
  t.onStateChange = (fn) => { t._onStateChange.push(fn); };

  // Test hooks: override the clock and drive passes manually.
  t._setClock = (nowMs) => { t._nowMs = nowMs; };
  t._tick = _tick;
  t._clearTimer = () => { if (t._timer) { clearInterval(t._timer); t._timer = null; } };

  t.dispose = () => {
    t._clearTimer();
    t.playing = false;
    t.recording = false;
    t._schedulers.length = 0;
  };

  return t;
}