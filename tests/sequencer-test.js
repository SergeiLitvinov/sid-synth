import { createMockAudioContext } from './mockAudioContext.js';
import { createTransport } from '../src/project/transport.js';
import { PatternSequencer } from '../src/sequencer/pattern.js';
import { SequencerComponent } from '../src/components/SequencerComponent.js';
import { OscillatorComponent } from '../src/components/OscillatorComponent.js';

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

// Transport on a fake clock + mock audio ctx kept in sync (ms <-> seconds).
function makeFollowFixture(bpm = 120) {
  let now = 0;
  const ctx = createMockAudioContext();
  const t = createTransport({ bpm });
  t._setClock(() => now);
  const seq = new PatternSequencer(ctx);
  seq.setPattern(['C4', null, null, null, 'E4', null, null, null,
    null, null, null, null, null, null, null, null]);
  seq.attachTransport(t);
  return {
    ctx, t, seq,
    set(ms) { now = ms; ctx.currentTime = ms / 1000; },
    play() { t.play(); t._clearTimer(); },
    stop() { t.stop(); seq.stop(); },
    // Kill the real 25ms interval so _schedule() can be driven by hand.
    freeze() { if (seq.timer) { clearInterval(seq.timer); seq.timer = null; } },
  };
}

// ---- transport follow -------------------------------------------------------
check('transport play starts the attached sequencer, stop halts and resets it', () => {
  const f = makeFollowFixture();
  f.play();
  f.freeze();
  const started = f.seq.isPlaying === true && f.seq.currentStep === 0;
  f.set(500);
  t_tick(f);
  f.stop();
  return started && f.seq.isPlaying === false && f.seq.currentStep === 0;
});
function t_tick(f) { f.t._tick(); }

check('seek snaps the sequencer step to the transport cursor', () => {
  const f = makeFollowFixture();
  f.play();
  f.t.seek(960); // 960 / 120 ticks-per-16th = step 8
  const ok = f.seq.currentStep === 8;
  f.stop();
  return ok;
});
check('tempo is live from the transport while following', () => {
  const f = makeFollowFixture();
  f.t.setBpm(140);
  const ok = Math.abs(f.seq.stepDuration - 60 / 140 / 4) < 1e-9;
  f.stop();
  return ok;
});
check('standalone sequencer keeps its own clock and local BPM', () => {
  const ctx = createMockAudioContext();
  const seq = new PatternSequencer(ctx, { bpm: 100 });
  seq.start();
  const ok = seq.isPlaying === true && Math.abs(seq.stepDuration - 60 / 100 / 4) < 1e-9;
  seq.stop();
  return ok && seq.isPlaying === false;
});
check('pause keeps the step, resume re-anchors and continues', () => {
  const f = makeFollowFixture();
  f.play();
  f.t.seek(960);
  f.t.pause();
  const kept = f.seq.isPlaying === false && f.seq.currentStep === 8;
  f.set(960);
  f.t.play(); // resume
  const resumed = f.seq.isPlaying === true && f.seq.currentStep === 8
    && f.seq.nextTime >= f.ctx.currentTime;
  f.stop();
  return kept && resumed;
});
check('loop wrap keeps the sequencer playing at the region-start step', () => {
  const f = makeFollowFixture();
  f.t.setLoopRegion(0, 1920);
  f.play();
  f.freeze();
  for (let i = 0; i < 22; i++) { f.set((i + 1) * 100); f.t._tick(); }
  const ok = f.seq.isPlaying === true && f.seq.currentStep === 0;
  f.stop();
  return ok;
});
check('gross drift snaps to the transport step, sub-step lookahead is untouched', () => {
  const f = makeFollowFixture();
  f.play();
  f.freeze();
  f.t.seek(960); // onSeek snaps currentStep to 8
  f.seq.currentStep = 0; // simulate a drifted local clock
  f.t._tick(); // onTick step=8: ahead by 8 -> snap
  const snapped = f.seq.currentStep === 8;
  f.seq.currentStep = 7; // one step of lookahead: leave alone
  f.t._tick();
  const kept = f.seq.currentStep === 7;
  f.stop();
  return snapped && kept;
});
check('disposed sequencer ignores transport events', () => {
  const f = makeFollowFixture();
  f.seq.dispose();
  f.play();
  const ok = f.seq.isPlaying === false;
  f.stop();
  return ok;
});

// ---- scheduled content ------------------------------------------------------
check('scheduled steps carry audio-time stamps spaced by the step duration', () => {
  const f = makeFollowFixture();
  const got = [];
  f.seq.onStep = (step, note, t0, dur) => { if (note) got.push({ step, t0, dur }); };
  f.play();
  f.freeze();
  f.set(0);
  f.seq.currentStep = 0;
  f.seq.nextTime = 0;
  for (let i = 0; i < 8; i++) { f.set(i * 125); f.seq._schedule(); }
  f.stop();
  // Steps 0 (C4) and 4 (E4) inside the first 8 sixteenths, 0.125s apart.
  return got.length === 2 && got[0].step === 0 && got[1].step === 4
    && Math.abs(got[1].t0 - got[0].t0 - 0.5) < 1e-9
    && Math.abs(got[0].dur - 0.125) < 1e-9;
});

// ---- component + oscillator -------------------------------------------------
check('component attach disables the local BPM input, detach restores it', () => {
  const ctx = createMockAudioContext();
  const t = createTransport({ bpm: 120 });
  const comp = new SequencerComponent(ctx);
  const input = comp.element.querySelector('input[type="number"]');
  comp.attachTransport(t);
  const disabled = input.disabled === true && comp.seq.transport === t;
  comp.detachTransport();
  const restored = input.disabled === false && comp.seq.transport === null;
  comp.dispose();
  t.stop();
  return disabled && restored;
});
check('oscillator frequency changes land at the scheduled note time', () => {
  const ctx = createMockAudioContext();
  const osc = new OscillatorComponent(ctx);
  osc.setFrequency(440, 1.5);
  const hist = osc.node.frequency._history;
  const ok = hist.length === 1 && hist[0].t === 'set' && hist[0].v === 440 && hist[0].at === 1.5;
  osc.dispose();
  return ok;
});
check('oscillator setFrequency without a time still applies immediately', () => {
  const ctx = createMockAudioContext();
  ctx.currentTime = 3.25;
  const osc = new OscillatorComponent(ctx);
  osc.setFrequency(220);
  const hist = osc.node.frequency._history;
  const ok = hist.length === 1 && hist[0].v === 220 && hist[0].at === 3.25;
  osc.dispose();
  return ok;
});

summary.textContent = `${passed.length} passed, ${failed.length} failed`;
if (failed.length) summary.className = 'fail';
window.__testResults = { passed: passed.length, failed: failed.length };
