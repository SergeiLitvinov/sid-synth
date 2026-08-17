// Adapter that drives an existing TrackEngine from a unified Transport.
// The engine keeps owning its voices and its internal scheduler (grid + rt
// note scheduling, cursor, realtime buffers); the transport owns the clock,
// the timer and the musical position. The engine's _tick is hooked into the
// transport's scheduler passes so one clock drives everything.

export function createStepEngineAdapter(engine, transport) {
  // Sync the engine's clock to the transport's so engine._tick computes the
  // same elapsed time the transport does.
  engine._setClock(transport._nowMs);

  transport.onStart(() => {
    engine._playing = true;
    engine._loopPos = 0;
    engine._loopCount = 0;
    engine._cursor = 0;
    engine._startMs = transport._startMs;
    engine._playStartCtx = transport._playStartCtx;
    engine._cursorLoopAbs = transport._playStartCtx;
    engine.tracks.forEach(t => {
      t.rt.forEach(ev => { ev._nextAbs = engine._playStartCtx + ev.start; });
    });
  });

  transport.onStop(() => {
    engine._recording = false;
    engine._commitBuffer(true);
    engine._playing = false;
    engine._loopPos = 0;
    engine._loopCount = 0;
    engine.tracks.forEach(t => t.voice.allOff(engine.ctx.currentTime));
  });

  // Each transport scheduler pass runs the engine's own scheduler tick.
  transport.addScheduler((nowAbs, endAbs, info) => {
    engine._tick();
  });

  // Mirror transport state onto the engine's public state API so the recorder
  // UI keeps working without knowing about the transport.
  transport.onStateChange((s) => {
    engine._playing = s.playing;
    engine._recording = s.recording;
    if (engine.onStateChange) engine.onStateChange(engine.getState());
  });

  engine._transport = transport;
  engine._adapterClock = transport._nowMs;

  // Keep the engine's public bpm in sync with the transport's tempo map.
  Object.defineProperty(engine, 'bpm', {
    get: () => transport.bpm,
    set: (v) => { transport.bpm = v; engine.recalcTempo(); },
    configurable: true,
  });

  // Route the engine's own transport commands through the unified transport.
  engine.play = () => transport.play();
  engine.record = () => {
    if (!engine._armed.size && engine.activeTrackId) engine.armTrack(engine.activeTrackId, true);
    engine._recording = true;
    engine._recBuffer.clear();
    engine.tracks.forEach(t => t.rt.forEach(ev => delete ev._open));
    transport.record();
  };
  engine.stop = () => transport.stop();
  engine.setBpm = (v) => { engine.bpm = v; };

  return engine;
}