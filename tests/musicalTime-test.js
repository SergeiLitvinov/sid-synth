import { DEFAULT_PPQ, beatTicks, barLengthTicks, barStartTicks, musicalToTicks, ticksToMusical } from '../src/project/musicalTime.js';
import { createTempoMap, tempoAt, signatureAt, addTempo, addSignature, ticksToSeconds, secondsToTicks, ticksToMusicalTime, musicalTimeToTicks } from '../src/project/tempoMap.js';

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

function near(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

const M4 = { num: 4, den: 4 };
const M3 = { num: 3, den: 4 };
const M68 = { num: 6, den: 8 };

// ---- musicalTime ----------------------------------------------------------
check('DEFAULT_PPQ is 480', () => DEFAULT_PPQ === 480);
check('beatTicks(4) is one bar in 4/4', () => beatTicks(4) === 1920);
check('barLengthTicks 4/4 is 1920', () => barLengthTicks(M4) === 1920);
check('barLengthTicks 3/4 is 1440', () => barLengthTicks(M3) === 1440);
check('barLengthTicks 6/8 is 1440', () => barLengthTicks(M68) === 1440);
check('barStartTicks bar 2 in 4/4 is 3840', () => barStartTicks(2, M4) === 3840);
check('musicalToTicks {2,3,120} in 4/4', () => musicalToTicks({ bar: 2, beat: 3, tick: 120 }, M4) === 3840 + 1440 + 120);
check('ticksToMusical round-trips 4/4', () => {
  const t = 5400;
  const m = ticksToMusical(t, M4);
  return m.bar === 2 && m.beat === 3 && m.tick === 120 && musicalToTicks(m, M4) === t;
});
check('ticksToMusical round-trips 3/4', () => {
  const t = 2640;
  const m = ticksToMusical(t, M3);
  return m.bar === 1 && m.beat === 2 && m.tick === 240 && musicalToTicks(m, M3) === t;
});
check('ticksToMusical round-trips 6/8 (beat = eighth note)', () => {
  const t = 1680;
  const m = ticksToMusical(t, M68);
  return m.bar === 1 && m.beat === 1 && m.tick === 0 && musicalToTicks(m, M68) === t;
});
check('musicalToTicks/ticksToMusical are inverse over a scan', () => {
  for (let t = 0; t <= 4800; t += 97) {
    const m = ticksToMusical(t, M4);
    if (musicalToTicks(m, M4) !== t) return false;
  }
  return true;
});

// ---- tempo map: tempo events ---------------------------------------------
check('createTempoMap defaults: 120bpm, 4/4, ppq 480', () => {
  const m = createTempoMap();
  return m.ppq === 480 && tempoAt(m, 0) === 120 && signatureAt(m, 0).num === 4 && signatureAt(m, 0).den === 4;
});
check('tempoAt before/after a tempo change', () => {
  const m = createTempoMap({ bpm: 120 });
  addTempo(m, 960, 90);
  return tempoAt(m, 0) === 120 && tempoAt(m, 959) === 120 && tempoAt(m, 960) === 90 && tempoAt(m, 100000) === 90;
});
check('addTempo replaces an event at the same tick', () => {
  const m = createTempoMap();
  addTempo(m, 480, 100);
  addTempo(m, 480, 140);
  return m.tempos.length === 2 && tempoAt(m, 480) === 140;
});
check('tempoAt stays at initial for negative ticks', () => {
  const m = createTempoMap({ bpm: 90 });
  addTempo(m, 480, 140);
  return tempoAt(m, -1) === 90;
});

// ---- tempo map: seconds ----------------------------------------------------
check('ticksToSeconds: 4/4 bar at 120bpm is 2s', () => {
  const m = createTempoMap({ bpm: 120 });
  return near(ticksToSeconds(m, 1920), 2.0) && near(ticksToSeconds(m, 960), 1.0) && ticksToSeconds(m, 0) === 0;
});
check('ticksToSeconds walks tempo changes', () => {
  const m = createTempoMap({ bpm: 120 });
  addTempo(m, 480, 240);
  return near(ticksToSeconds(m, 1440), 1.0);
});
check('secondsToTicks inverts ticksToSeconds (single tempo)', () => {
  const m = createTempoMap({ bpm: 120 });
  for (let t = 0; t <= 7680; t += 240) {
    const s = ticksToSeconds(m, t);
    if (!near(secondsToTicks(m, s), t)) return false;
  }
  return true;
});
check('secondsToTicks inverts ticksToSeconds (tempo change)', () => {
  const m = createTempoMap({ bpm: 120 });
  addTempo(m, 480, 240);
  addTempo(m, 1440, 60);
  for (let t = 0; t <= 4800; t += 240) {
    const s = ticksToSeconds(m, t);
    if (!near(secondsToTicks(m, s), t)) return false;
  }
  return true;
});
check('negative/zero guards for seconds conversion', () => {
  const m = createTempoMap();
  return ticksToSeconds(m, -5) === 0 && secondsToTicks(m, -5) === 0 && secondsToTicks(m, 0) === 0;
});

// ---- tempo map: time signatures -------------------------------------------
check('addSignature changes signatureAt', () => {
  const m = createTempoMap();
  addSignature(m, 1920, 3, 4);
  const before = signatureAt(m, 1919);
  const after = signatureAt(m, 1920);
  return before.num === 4 && before.den === 4 && after.num === 3 && after.den === 4;
});
check('addSignature replaces at same tick', () => {
  const m = createTempoMap();
  addSignature(m, 480, 6, 8);
  addSignature(m, 480, 3, 4);
  return m.signatures.length === 2 && signatureAt(m, 480).num === 3;
});
check('musicalTimeToTicks crosses a signature change', () => {
  const m = createTempoMap();
  addSignature(m, 1920, 3, 4); // bar0 = 4/4 [0,1920), bar1+ = 3/4
  return musicalTimeToTicks(m, { bar: 1, beat: 0, tick: 0 }) === 1920 &&
         musicalTimeToTicks(m, { bar: 2, beat: 1, tick: 0 }) === 1920 + 1440 + 480;
});
check('ticksToMusicalTime respects signature at tick', () => {
  const m = createTempoMap();
  addSignature(m, 1920, 3, 4);
  const a = ticksToMusicalTime(m, 1920);
  const b = ticksToMusicalTime(m, 2400);
  const c = ticksToMusicalTime(m, 3840);
  return a.bar === 1 && a.beat === 0 && a.tick === 0 &&
         b.bar === 1 && b.beat === 1 && b.tick === 0 &&
         c.bar === 2 && c.beat === 1 && c.tick === 0;
});
check('bar lengths after a signature change', () => {
  const m = createTempoMap();
  addSignature(m, 1920, 3, 4);
  const b0 = musicalTimeToTicks(m, { bar: 1, beat: 0, tick: 0 }) - musicalTimeToTicks(m, { bar: 0, beat: 0, tick: 0 });
  const b1 = musicalTimeToTicks(m, { bar: 2, beat: 0, tick: 0 }) - musicalTimeToTicks(m, { bar: 1, beat: 0, tick: 0 });
  return b0 === 1920 && b1 === 1440;
});
check('musicalTimeToTicks/ticksToMusicalTime inverse across signature change', () => {
  const m = createTempoMap();
  addSignature(m, 1920, 3, 4);
  addSignature(m, 4800, 6, 8);
  for (let t = 0; t <= 7200; t += 60) {
    const mu = ticksToMusicalTime(m, t);
    if (musicalTimeToTicks(m, mu) !== t) return false;
  }
  return true;
});

summary.textContent = `${passed.length} passed, ${failed.length} failed`;
if (failed.length) summary.className = 'fail';
window.__testResults = { passed: passed.length, failed: failed.length };
