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
    loopEnabled: cfg.loopEnabled !== undefined ? cfg.loopEnabled : false,
    loopStartTicks: cfg.loopStartTicks !== undefined ? cfg.loopStartTicks : 0,
    loopEndTicks: cfg.loopEndTicks !== undefined ? cfg.loopEndTicks
      : (cfg.loopLenTicks !== undefined ? cfg.loopLenTicks : 4 * tempoMap.ppq),
    projectEndTicks: cfg.projectEndTicks !== undefined ? cfg.projectEndTicks : null,
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
    _onSeek: [],
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

    // Project end: stop playback when we reach it.
    if (t.projectEndTicks !== null && totalTicks >= t.projectEndTicks) {
      t.stop();
      return;
    }

    let loopPosTicks;
    let loop;

    if (t.loopEnabled) {
      // Loop within [loopStartTicks, loopEndTicks].
      const regionLen = Math.max(1, t.loopEndTicks - t.loopStartTicks);
      const offset = Math.max(0, totalTicks - t.loopStartTicks);
      loop = Math.floor(offset / regionLen);
      loopPosTicks = t.loopStartTicks + (offset - loop * regionLen);
      if (loop > t._loopCount) {
        t._loopCount = loop;
        emit(t._onLoopWrap, t._loopCount);
      }
    } else {
      // Linear: total ticks = position, loopCount = 0.
      loop = 0;
      loopPosTicks = totalTicks;
      if (t._loopCount !== 0) {
        t._loopCount = 0;
        emit(t._onLoopWrap, 0);
      }
    }

    t._loopPosTicks = loopPosTicks;
    for (const s of t._schedulers) s(nowAbs, endAbs, {
      elapsed,
      loopPosTicks,
      loopCount: loop,
    });
    emit(t._onTick, {
      loopPosTicks,
      loopPosSec: ticksToSeconds(tempoMap, loopPosTicks),
      step: Math.floor(loopPosTicks / (t.ppq / 4)) % 16,
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
    loopEnabled: t.loopEnabled,
    loopStartTicks: t.loopStartTicks,
    loopEndTicks: t.loopEndTicks,
    projectEndTicks: t.projectEndTicks,
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
    let pos = Math.max(0, Math.round(tick));
    if (t.projectEndTicks !== null) pos = Math.min(pos, t.projectEndTicks);
    if (t.loopEnabled) {
      const regionLen = Math.max(1, t.loopEndTicks - t.loopStartTicks);
      const offset = pos - t.loopStartTicks;
      pos = t.loopStartTicks + ((offset % regionLen) + regionLen) % regionLen;
      t._loopCount = Math.floor((tick - t.loopStartTicks) / regionLen);
      if (t._loopCount < 0) t._loopCount = 0;
    } else {
      t._loopCount = 0;
    }
    t._loopPosTicks = pos;
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
    emit(t._onSeek, { pos, playing: t.playing, loopCount: t._loopCount });
    emitState();
  };

  // Set the loop region and toggle. Calls _syncLoopLen for backward compat.
  t.setLoopRegion = (startTicks, endTicks) => {
    t.loopStartTicks = Math.max(0, Math.round(startTicks));
    t.loopEndTicks = Math.max(t.loopStartTicks + 1, Math.round(endTicks));
    t.loopEnabled = true;
    emitState();
  };

  t.setLoopEnabled = (enabled) => {
    t.loopEnabled = !!enabled;
    emitState();
  };

  t.setProjectEnd = (ticks) => {
    t.projectEndTicks = ticks !== null ? Math.max(1, Math.round(ticks)) : null;
    emitState();
  };

  // loopLenTicks is a derived property: always returns the region length
  // (loopEndTicks - loopStartTicks). The setter is kept for backward compat
  // (sets loopEnd from 0).
  Object.defineProperty(t, 'loopLenTicks', {
    get() {
      return Math.max(1, t.loopEndTicks - t.loopStartTicks);
    },
    set(v) {
      // Legacy write: treat as setting loopEndTicks from 0.
      t.loopEndTicks = Math.max(1, v);
      t.loopStartTicks = 0;
    },
    enumerable: true,
  });

  t.addScheduler = (fn) => {
    t._schedulers.push(fn);
    return () => { t._schedulers = t._schedulers.filter(s => s !== fn); };
  };

  t.onStart = (fn) => { t._onStart.push(fn); };
  t.onStop = (fn) => { t._onStop.push(fn); };
  t.onTick = (fn) => { t._onTick.push(fn); };
  t.onLoopWrap = (fn) => { t._onLoopWrap.push(fn); };
  t.onSeek = (fn) => { t._onSeek.push(fn); };
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