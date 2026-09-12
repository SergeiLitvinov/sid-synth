// Adapter that drives an existing TrackEngine from a unified Transport.
// The engine keeps owning its voices and its internal scheduler (clip-event
// scheduling, cursor, realtime buffers); the transport owns the clock,
// the timer and the musical position. The engine's _tick is hooked into the
// transport's scheduler passes so one clock drives everything.

import { STEPS_PER_LOOP } from './trackEngine.js';
import { stepTicks } from '../project/clipEvents.js';
import { ticksToSeconds } from '../project/tempoMap.js';

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
    engine._resetLinearPlayback();
  });

  transport.onStop(() => {
    engine._recording = false;
    engine._commitBuffer(true);
    engine._playing = false;
    engine._loopPos = 0;
    engine._loopCount = 0;
    engine.tracks.forEach(t => t.voice.allOff(engine.ctx.currentTime));
    if (typeof engine._stopAudio === 'function') engine._stopAudio();
  });

  // Pause suspends sound but keeps every position, cursor and flag intact
  // for a seamless resume (unlike stop, which rewinds). Future-scheduled
  // events are released back to the scheduler (finished ones stay retired)
  // so resume replays the window instead of dropping it.
  transport.onPause(() => {
    engine._recording = false;
    engine._playing = false;
    engine.tracks.forEach(t => t.voice.allOff(engine.ctx.currentTime));
    if (typeof engine._stopAudio === 'function') engine._stopAudio();
    engine._resetLinearPlayback();
    if (typeof engine._markPastLinear === 'function') {
      engine._markPastLinear(transport._loopPosTicks);
    }
    engine.tracks.forEach(t => (t.clips || []).forEach(c => { delete c._scheduledAudio; }));
  });

  // Resume continues from the kept position: rebase the running clock under
  // it (positions/cursors/flags were never cleared), re-anchor the step
  // grid to now (the anchor went stale over the pause gap), and chase
  // sustained notes, mirroring the seek tail without touching transport.
  transport.onResume(() => {
    engine._playing = true;
    engine._startMs = transport._startMs;
    engine._playStartCtx = transport._playStartCtx;
    // Re-anchor the step grid to now: the cursor step sounds on resume,
    // later steps keep grid time. (The anchor went stale over the pause.)
    engine._cursorLoopAbs = transport._playStartCtx - engine._cursor * engine.stepDur;
    engine.chaseToTick(transport._loopPosTicks);
  });

  transport.onSeek(({ pos, playing }) => {
    if (!playing) return;
    // Seek rebases the transport clock itself, so the engine copies it.
    resyncEngineTo(pos, transport._loopCount, {
      startMs: transport._startMs,
      playStartCtx: transport._playStartCtx,
      cursorLoopAbs: transport._playStartCtx + transport._loopCount * engine.loopDur,
    });
  });

  // A transport loop wrap re-enters the region the same way a seek to its
  // start would: without this the engine keeps its own free-running clock
  // and plays through excluded bars (position + sound desync). Unlike seek
  // the transport keeps counting here, so the engine clock is rebased from
  // region ticks while the transport clock is left alone.
  transport.onLoopWrap((loopCount) => {
    if (!transport.playing || !transport.loopEnabled) return;
    const posTicks = transport.loopStartTicks;
    const posSec = ticksToSeconds(transport.tempoMap, posTicks);
    resyncEngineTo(posTicks, loopCount, {
      startMs: engine._nowMs() - posSec * 1000,
      playStartCtx: (engine.ctx ? engine.ctx.currentTime : 0) + 0.03,
      cursorLoopAbs: (engine.ctx ? engine.ctx.currentTime : 0) + 0.03,
    });
  });

  // Shared seek/wrap resync: kill stale voices, rebase the engine clock to
  // the song position, realign cursor, retire finished events, chase.
  function resyncEngineTo(posTicks, loopCount, clock) {
    // Kill voices that were sounding at the old position to avoid bleed.
    engine.tracks.forEach(t => t.voice.allOff(engine.ctx.currentTime));
    if (typeof engine._stopAudio === 'function') engine._stopAudio();
    engine._startMs = clock.startMs;
    engine._playStartCtx = clock.playStartCtx;
    // Reset grid cursor to the step matching the new loop-relative position.
    const ticksToSec = engine.stepDur / stepTicks(engine.ppq);
    engine._loopPos = posTicks * ticksToSec;
    engine._loopCount = loopCount;
    const stepDurTicks = stepTicks(engine.ppq);
    engine._cursor = Math.floor(posTicks / stepDurTicks) % STEPS_PER_LOOP;
    engine._cursorLoopAbs = clock.cursorLoopAbs;
    // Reset linear playback flags so events before the seek can be rescheduled.
    engine._resetLinearPlayback();
    // ...then immediately retire the finished ones, so the scheduler does
    // not replay them from the top (it cannot tell a seek from jitter).
    if (typeof engine._markPastLinear === 'function') engine._markPastLinear(posTicks);
    // Chase: re-trigger sustained notes at the new position.
    engine.chaseToTick(posTicks);
  }

  // Each transport scheduler pass runs the engine's own scheduler tick,
  // forwarding the transport position info for loop-region clamping.
  transport.addScheduler((nowAbs, endAbs, info) => {
    engine._tick(info);
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
    engine.prepareRecording();
    transport.record();
  };
  engine.stop = () => transport.stop();
  engine.setBpm = (v) => { engine.bpm = v; };

  return engine;
}
