import { createMockAudioContext } from './mockAudioContext.js';
import { createTrackEngine } from '../src/tracks/trackEngine.js';
import { createTransport } from '../src/project/transport.js';
import { createStepEngineAdapter } from '../src/tracks/stepEngineAdapter.js';
import { createTempoMap, tempoAt } from '../src/project/tempoMap.js';

const results = document.getElementById('results');
const summary = document.getElementById('summary');
const passed = [];
const failed = [];

function check(name, fn) {
  try {
    if (fn() === false) throw new Error('assertion returned false');
    passed.push(name);
    const li = document.createElement('li');
    li.textContent = `PASS  ${name}`;
    results.appendChild(li);
  } catch (err) {
    failed.push(name);
    const li = document.createElement('li');
    li.className = 'fail';
    li.textContent = `FAIL  ${name}: ${err.message}`;
    results.appendChild(li);
  }
}

function near(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

// Transport with a manually-advanced fake clock (no real timer).
function makeTransportFixture(bpm = 120, opts = {}) {
  let now = 0;
  const t = createTransport({ bpm, ...opts });
  t._setClock(() => now);
  const f = {
    t, now,
    set(ms) { now = ms; },
    play() { t.play(); t._clearTimer(); },
    stop() { t.stop(); },
    advanceAndTick(deltaMs) { now += deltaMs; t._tick(); },
  };
  return f;
}

// ---- transport alone ------------------------------------------------------
check('transport defaults: ppq 480, one-bar loop, idle', () => {
  const t = createTransport({ bpm: 120 });
  const s = t.getState();
  return t.ppq === 480 && t.loopLenTicks === 1920 && s.playing === false && s.recording === false && s.bpm === 120;
});
check('play starts and records position in ticks', () => {
  const f = makeTransportFixture(120);
  f.play();
  f.advanceAndTick(1000); // 1s at 120bpm -> 960 ticks
  const s = f.t.getState();
  return s.playing === true && s.loopPosTicks === 960 && s.step === 8;
});
check('position maps back to seconds', () => {
  const f = makeTransportFixture(120);
  f.play();
  f.advanceAndTick(1000); // 960 ticks at 120bpm = half a 2s bar = 1s
  return near(f.t.getState().loopPosSec, 1.0);
});
check('loop wraps at loopLenTicks and fires onLoopWrap', () => {
  const f = makeTransportFixture(120, { loopEnabled: true });
  let wraps = 0;
  f.t.onLoopWrap((n) => { wraps = n; });
  f.play();
  f.advanceAndTick(2000); // exactly one bar
  return wraps === 1 && f.t.getState().loopCount === 1 && f.t.getState().loopPosTicks === 0;
});
check('step advances across the bar', () => {
  const f = makeTransportFixture(120);
  f.play();
  f.advanceAndTick(125); // one sixteenth at 120bpm
  return f.t.getState().step === 1;
});
check('scheduler receives advancing absolute windows', () => {
  const f = makeTransportFixture(120);
  const windows = [];
  f.t.addScheduler((nowAbs, endAbs) => windows.push({ nowAbs, endAbs }));
  f.play();
  f.advanceAndTick(100);
  f.advanceAndTick(100);
  const first = windows[0], last = windows[windows.length - 1];
  return windows.length >= 3 && last.nowAbs > first.nowAbs && near(last.endAbs - last.nowAbs, f.t.lookahead, 1e-9);
});
check('bpm setter updates the tempo map', () => {
  const f = makeTransportFixture(120);
  f.t.setBpm(90);
  return tempoAt(f.t.tempoMap, 0) === 90 && f.t.getState().bpm === 90;
});
check('tempo affects ticks-to-seconds', () => {
  const f = makeTransportFixture(120);
  f.play();
  f.t.setBpm(240);
  f.advanceAndTick(500); // 0.5s at 240bpm -> 960 ticks
  return f.t.getState().loopPosTicks === 960;
});
check('stop resets transport to idle', () => {
  const f = makeTransportFixture(120);
  f.play();
  f.advanceAndTick(500);
  f.stop();
  const s = f.t.getState();
  return s.playing === false && s.recording === false && s.loopPosTicks === 0 && s.loopCount === 0;
});
check('record sets recording and plays if idle', () => {
  const f = makeTransportFixture(120);
  f.t.record();
  const s = f.t.getState();
  return s.recording === true && s.playing === true;
});
check('custom ppq and loop length respected', () => {
  const t = createTransport({ ppq: 96, bpm: 120, loopLenTicks: 96 * 8 });
  return t.ppq === 96 && t.loopLenTicks === 768;
});
check('createTransport honors an injected tempo map', () => {
  const map = createTempoMap({ ppq: 96, bpm: 60 });
  const t = createTransport({ tempoMap: map });
  return t.tempoMap === map && t.ppq === 96 && t.bpm === 60;
});

// ---- seek (backlog #16: markers navigate the timeline) --------------------
check('seek moves the position to an absolute tick (stopped)', () => {
  const f = makeTransportFixture(120, { loopEnabled: true });
  f.t.seek(1920);
  const s = f.t.getState();
  return s.playing === false
    && s.loopPosTicks === 0 && s.loopCount === 1
    && (s.loopCount * s.loopLenTicks + s.loopPosTicks) === 1920;
});
check('seek clamps negative ticks to zero', () => {
  const f = makeTransportFixture(120);
  f.t.seek(-500);
  return f.t.getState().loopPosTicks === 0 && f.t.getState().loopCount === 0;
});
check('seek while stopped fires an onTick update', () => {
  const f = makeTransportFixture(120);
  let seen = null;
  f.t.onTick((info) => { seen = info; });
  f.t.seek(960);
  return seen !== null && seen.loopPosTicks === 960 && seen.loopCount === 0;
});
check('seek while playing rebases the clock', () => {
  const f = makeTransportFixture(120, { loopEnabled: true });
  f.play();
  f.t.seek(1920);
  const posAfterSeek = f.t.getState().loopPosTicks;
  const countAfterSeek = f.t.getState().loopCount;
  f.advanceAndTick(250); // 250ms later -> position ~480 ticks past the seek point
  const s = f.t.getState();
  return posAfterSeek === 0 && countAfterSeek === 1 && s.playing === true && s.loopPosTicks > 0 && s.loopPosTicks < 960;
});

// ---- transport + step engine adapter --------------------------------------
function makeAdapterFixture(bpm = 120) {
  let now = 0;
  const ctx = createMockAudioContext();
  const engine = createTrackEngine(ctx, ctx.destination, { bpm });
  const transport = createTransport({ bpm });
  transport._setClock(() => now);
  createStepEngineAdapter(engine, transport);
  const track = engine.addTrack({ name: 'T1', id: 'trk_a' });
  engine.activeTrackId = 'trk_a';
  const spy = [];
  const orig = track.voice.noteOn.bind(track.voice);
  track.voice.noteOn = (note, at, dur) => { spy.push({ note, at, dur }); orig(note, at, dur); };
  const f = {
    engine, transport, track, ctx, spy,
    set(ms) { now = ms; },
    play() { engine.play(); transport._clearTimer(); },
    record() { engine.record(); transport._clearTimer(); },
    stop() { engine.stop(); },
    advanceAndTick(deltaMs) { now += deltaMs; transport._tick(); },
  };
  return f;
}

check('adapter: engine.play routes through transport', () => {
  const f = makeAdapterFixture(120);
  f.play();
  return f.transport.playing === true && f.engine._playing === true;
});
check('adapter: engine state mirrors transport', () => {
  const f = makeAdapterFixture(120);
  f.play();
  const s = f.engine.getState();
  return s.playing === true;
});
check('adapter: grid notes scheduled on the audio clock', () => {
  const f = makeAdapterFixture(120);
  f.engine.toggleGridStep('trk_a', 0, 'C4');
  f.play();
  f.advanceAndTick(100);
  const hit = f.spy.find(s => s.note === 'C4');
  return !!hit && near(hit.at, 0.03);
});
check('adapter: grid loop repeats across wrap', () => {
  const f = makeAdapterFixture(120);
  f.engine.toggleGridStep('trk_a', 0, 'C4');
  f.play();
  f.advanceAndTick(2100); // past one loop
  const hits = f.spy.filter(s => s.note === 'C4');
  return hits.length >= 2 && near(hits[1].at - hits[0].at, 2.0, 1e-3);
});
check('adapter: engine.bpm is synced to transport', () => {
  const f = makeAdapterFixture(120);
  f.engine.setBpm(90);
  return f.engine.bpm === 90 && f.transport.bpm === 90 && tempoAt(f.transport.tempoMap, 0) === 90;
});
check('adapter: engine.stepDur recalculates from transport bpm', () => {
  const f = makeAdapterFixture(120);
  f.engine.setBpm(60);
  return near(f.engine.stepDur, 0.25) && near(f.engine.loopDur, 4.0);
});
check('adapter: record arms and captures realtime notes', () => {
  const f = makeAdapterFixture(120);
  f.record();
  f.engine.noteOn('C2');
  f.advanceAndTick(200);
  f.engine.noteOff('C2');
  f.stop();
  return f.track.rt.length === 1 && f.track.rt[0].note === 'C2' && f.track.rt[0].dur > 0.03;
});
check('adapter: engine.stop commits buffer and resets', () => {
  const f = makeAdapterFixture(120);
  f.record();
  f.engine.noteOn('C2');
  f.advanceAndTick(100);
  f.stop();
  const s = f.engine.getState();
  return s.playing === false && s.recording === false && f.track.rt.length === 1;
});
check('adapter: onStop silences voices', () => {
  const f = makeAdapterFixture(120);
  f.record();
  f.engine.noteOn('C2');
  f.advanceAndTick(50);
  f.stop();
  return f.spy.some(s => s.note === 'C2');
});
check('adapter: grid + rt play together', () => {
  const f = makeAdapterFixture(120);
  f.engine.toggleGridStep('trk_a', 0, 'C4');
  f.record();
  f.engine.noteOn('E2');
  f.advanceAndTick(100);
  f.engine.noteOff('E2');
  f.advanceAndTick(100);
  f.stop();
  const notes = f.spy.map(s => s.note);
  return notes.includes('C4') && notes.includes('E2');
});
check('adapter: arranged clips replay after transport restart', () => {
  const f = makeAdapterFixture(120);
  f.engine.addClip('trk_a', { start: 0, length: 1920 }); // loop mirror
  f.engine.addClip('trk_a', { start: 1920, length: 1920, events: [{ note: 'A3', start: 0, dur: 240 }] });
  f.play();
  f.set(2000); f.transport._tick();
  const first = f.spy.filter(s => s.note === 'A3').length;
  f.stop();
  f.set(2000); f.play();
  f.set(3900); f.transport._tick(); // elapsed 1.9s after the second start
  const second = f.spy.filter(s => s.note === 'A3').length;
  return first === 1 && second === 2;
});

// ---- onSeek event --------------------------------------------------------
check('seek fires onSeek event with position info', () => {
  const f = makeTransportFixture(120);
  f.play();
  let seen = null;
  f.t.onSeek((info) => { seen = info; });
  f.t.seek(960);
  return seen !== null && seen.pos === 960 && seen.playing === true && seen.loopCount === 0;
});
check('seek while stopped does not fire onSeek (no chase needed)', () => {
  const f = makeTransportFixture(120);
  let seen = null;
  f.t.onSeek((info) => { seen = info; });
  f.t.seek(480);
  return seen !== null && seen.playing === false;
});

// ---- adapter seek + chase ------------------------------------------------
check('adapter: seek while playing kills old voices and chases sustained notes', () => {
  const f = makeAdapterFixture(120);
  // Create loop clip and populate with a sustained note at step 2 (tick 240..480)
  f.engine.addClip('trk_a', { start: 0, length: 1920 });
  f.engine.setClipEvents('trk_a', f.track.clips[0].id, [
    { note: 'C4', start: 240, dur: 240, velocity: 100 },
  ]);
  f.play();
  f.set(500); f.transport._tick(); // at tick ~600, note ended
  f.spy.length = 0;
  // Seek to tick 360 — inside the note (240..480), should chase
  f.transport.seek(360);
  const chased = f.spy.filter(s => s.note === 'C4');
  return chased.length === 1 && chased[0].dur > 0 && chased[0].dur < 0.25;
});
check('adapter: seek does not chase notes that ended before the seek point', () => {
  const f = makeAdapterFixture(120);
  f.engine.addClip('trk_a', { start: 0, length: 1920 });
  f.engine.setClipEvents('trk_a', f.track.clips[0].id, [
    { note: 'C4', start: 0, dur: 120, velocity: 100 }, // ends at tick 120
  ]);
  f.play();
  f.set(500); f.transport._tick();
  f.spy.length = 0;
  f.transport.seek(240); // well past the note
  return f.spy.filter(s => s.note === 'C4').length === 0;
});
check('adapter: seek does not chase notes that start after the seek point', () => {
  const f = makeAdapterFixture(120);
  f.engine.addClip('trk_a', { start: 0, length: 1920 });
  f.engine.setClipEvents('trk_a', f.track.clips[0].id, [
    { note: 'C4', start: 480, dur: 120, velocity: 100 }, // starts at tick 480
  ]);
  f.play();
  f.set(500); f.transport._tick();
  f.spy.length = 0;
  f.transport.seek(240); // before the note starts
  return f.spy.filter(s => s.note === 'C4').length === 0;
});
check('adapter: seek chases arranged clip sustained notes', () => {
  const f = makeAdapterFixture(120);
  f.engine.addClip('trk_a', { start: 0, length: 1920 }); // loop mirror
  f.engine.addClip('trk_a', { start: 1920, length: 1920, events: [
    { note: 'A3', start: 0, dur: 480, velocity: 100 }, // sounds tick 1920..2400
  ]});
  f.play();
  f.set(3000); f.transport._tick();
  f.spy.length = 0;
  f.transport.seek(2160); // inside the arranged note (1920..2400)
  const chased = f.spy.filter(s => s.note === 'A3');
  return chased.length === 1 && chased[0].dur > 0 && chased[0].dur < 0.5;
});
check('adapter: seek resets linear playback flags', () => {
  const f = makeAdapterFixture(120);
  f.engine.addClip('trk_a', { start: 0, length: 1920 }); // loop mirror
  f.engine.addClip('trk_a', { start: 1920, length: 1920, events: [
    { note: 'A3', start: 0, dur: 120, velocity: 100 },
  ]});
  f.play();
  f.set(2500); f.transport._tick(); // A3 plays at tick 1920
  const ev = f.track.clips[1].events[0];
  return ev._scheduledLin === true;
});
check('adapter: seek clears linear flags so events can replay', () => {
  const f = makeAdapterFixture(120);
  f.engine.addClip('trk_a', { start: 0, length: 1920 }); // loop mirror
  f.engine.addClip('trk_a', { start: 1920, length: 1920, events: [
    { note: 'A3', start: 0, dur: 120, velocity: 100 },
  ]});
  f.play();
  f.set(2500); f.transport._tick();
  f.transport.seek(0); // seek back to start
  const ev = f.track.clips[1].events[0];
  return ev._scheduledLin !== true;
});

// ---- loop locators (backlog #155) ---------------------------------------
check('loopEnabled defaults to false', () => {
  const t = createTransport({ bpm: 120 });
  return t.loopEnabled === false && t.loopStartTicks === 0 && t.loopEndTicks === 1920;
});
check('setLoopRegion enables loop and sets bounds', () => {
  const t = createTransport({ bpm: 120 });
  t.setLoopRegion(480, 1440);
  return t.loopEnabled === true && t.loopStartTicks === 480 && t.loopEndTicks === 1440 && t.loopLenTicks === 960;
});
check('setLoopEnabled toggles loop on/off', () => {
  const t = createTransport({ bpm: 120 });
  t.setLoopEnabled(true);
  return t.loopEnabled === true;
});
check('loopEnabled false plays linearly (no wrapping)', () => {
  const f = makeTransportFixture(120);
  f.play();
  f.advanceAndTick(3000); // 3s = 2880 ticks — past one bar
  const s = f.t.getState();
  return s.loopPosTicks === 2880 && s.loopCount === 0;
});
check('loopEnabled true wraps within [start, end]', () => {
  const f = makeTransportFixture(120, { loopEnabled: true, loopStartTicks: 480, loopEndTicks: 1440 });
  let wraps = 0;
  f.t.onLoopWrap((n) => { wraps++; });
  f.play();
  f.advanceAndTick(1500); // 1440 ticks total; offset from 480 = 960 → within region, no wrap yet
  const s1 = f.t.getState();
  f.advanceAndTick(600); // total 1920; offset 1440 → 1 full wrap → back to start
  const s2 = f.t.getState();
  return wraps >= 1 && s2.loopPosTicks >= 480 && s2.loopPosTicks < 1440;
});
check('loopLenTicks derived from loopStart/end', () => {
  const t = createTransport({ bpm: 120, loopStartTicks: 240, loopEndTicks: 720 });
  return t.loopLenTicks === 480;
});
check('loopLenTicks setter sets loopEnd from 0', () => {
  const t = createTransport({ bpm: 120 });
  t.loopLenTicks = 960;
  return t.loopEndTicks === 960 && t.loopStartTicks === 0;
});

// ---- project end (backlog #155) -----------------------------------------
check('projectEndTicks defaults to null', () => {
  const t = createTransport({ bpm: 120 });
  return t.projectEndTicks === null;
});
check('setProjectEnd sets project end ticks', () => {
  const t = createTransport({ bpm: 120 });
  t.setProjectEnd(5760);
  return t.projectEndTicks === 5760;
});
check('setProjectEnd(null) clears project end', () => {
  const t = createTransport({ bpm: 120 });
  t.setProjectEnd(5760);
  t.setProjectEnd(null);
  return t.projectEndTicks === null;
});
check('playback stops at project end', () => {
  const f = makeTransportFixture(120);
  f.t.setProjectEnd(960); // stop after 960 ticks (0.5s at 120bpm)
  f.play();
  f.advanceAndTick(1200); // 1s = 960 ticks → should have stopped
  return f.t.getState().playing === false;
});
check('seek is clamped to project end', () => {
  const t = createTransport({ bpm: 120 });
  t.setProjectEnd(960);
  t.seek(2000);
  return t.getState().loopPosTicks <= 960;
});
check('getState includes loop/project fields', () => {
  const t = createTransport({ bpm: 120, loopEnabled: true, loopStartTicks: 0, loopEndTicks: 1920 });
  t.setProjectEnd(5760);
  const s = t.getState();
  return s.loopEnabled === true && s.loopStartTicks === 0 && s.loopEndTicks === 1920 && s.projectEndTicks === 5760;
});

summary.textContent = `${passed.length} passed, ${failed.length} failed`;
if (failed.length) summary.className = 'fail';
window.__testResults = { passed: passed.length, failed: failed.length };