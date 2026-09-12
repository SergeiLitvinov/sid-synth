import { createMockAudioContext } from './mockAudioContext.js';
import { TrackVoices } from '../src/tracks/voiceEngine.js';

const results = document.getElementById('results');
const summary = document.getElementById('summary');
const passed = [];
const failed = [];
const queue = [];

function check(name, fn) {
  queue.push({ name, fn });
}

function makeTrack(adsr = { a: 0.01, d: 0.1, s: 0.7, r: 0.1 }) {
  return { wave: 'sine', filterType: 'none', filterFreq: 1200, filterQ: 1, adsr, volume: 0.85, inserts: [] };
}

function makeVoices(ctx, adsr) {
  return new TrackVoices(ctx, makeTrack(adsr), ctx.destination);
}

function gainHistory(v) {
  return v.env.gain._history;
}

// ---- analytic release levels (mock) -----------------------------------------
check('release mid-attack starts from the attack level', () => {
  const ctx = createMockAudioContext();
  const tv = makeVoices(ctx, { a: 0.2, d: 0.2, s: 0.5, r: 0.1 });
  tv.noteOn('C4', 0, undefined, 100);
  tv.noteOff('C4', 0.05);
  const v = tv.voices.find(x => x.osc);
  const rel = gainHistory(v).filter(h => h.t === 'set' && h.at === 0.05);
  const scale = 100 / 127;
  return rel.length === 1 && Math.abs(rel[0].v - scale * 0.05 / 0.2) < 1e-9;
});
check('release mid-decay starts from the decay level', () => {
  const ctx = createMockAudioContext();
  const tv = makeVoices(ctx, { a: 0.2, d: 0.2, s: 0.5, r: 0.1 });
  tv.noteOn('C4', 0, undefined, 100);
  tv.noteOff('C4', 0.3);
  const v = tv.voices.find(x => x.osc);
  const rel = gainHistory(v).filter(h => h.t === 'set' && h.at === 0.3);
  const scale = 100 / 127;
  return rel.length === 1 && Math.abs(rel[0].v - scale * 0.75) < 1e-9;
});
check('release after sustain starts from the sustain level', () => {
  const ctx = createMockAudioContext();
  const tv = makeVoices(ctx, { a: 0.01, d: 0.1, s: 0.7, r: 0.1 });
  tv.noteOn('C4', 0, undefined, 100);
  tv.noteOff('C4', 1.0);
  const v = tv.voices.find(x => x.osc);
  const rel = gainHistory(v).filter(h => h.t === 'set' && h.at === 1.0);
  return rel.length === 1 && Math.abs(rel[0].v - (100 / 127) * 0.7) < 1e-9;
});

// ---- lookahead stealing (mock) ----------------------------------------------
check('a voice freeing before the scheduled time is reused, not stolen', () => {
  const ctx = createMockAudioContext();
  const tv = makeVoices(ctx, { a: 0.01, d: 0.05, s: 0.8, r: 0.1 });
  const names = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
  names.forEach((n, i) => tv.noteOn(n, 0, (i + 1) * 0.2, 100)); // busy until ~0.31..1.71
  const before = tv.voices.reduce((s, v) => s + gainHistory(v).length, 0);
  tv.noteOn('D5', 2.0, undefined, 100); // every voice is free by 2.0
  const after = tv.voices.reduce((s, v) => s + gainHistory(v).length, 0);
  // scheduleEnvelope only (set + 2 ramps); a steal would add resetVoice's set.
  return after - before === 3;
});
check('a truly busy voice is stolen from the earliest finisher', () => {
  const ctx = createMockAudioContext();
  const tv = makeVoices(ctx, { a: 0.01, d: 0.05, s: 0.8, r: 0.1 });
  const names = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
  names.forEach((n, i) => tv.noteOn(n, 0, 5, 100)); // all busy until ~5.2
  tv.noteOn('D5', 0.5, undefined, 100); // must steal voice 0 (earliest end)
  const v0 = tv.voices[0];
  const cut = gainHistory(v0).some(h => h.t === 'set' && h.v === 0 && h.at === 0.5);
  return cut && tv.voices.filter(v => v.busyUntil > 1).length === 8;
});

// ---- restrike (mock) ----------------------------------------------------------
check('same-pitch restrike under sustain cuts and re-attacks once', () => {
  const ctx = createMockAudioContext();
  const tv = makeVoices(ctx, { a: 0.01, d: 0.1, s: 0.7, r: 0.1 });
  tv.noteOn('C4', 0, undefined, 100);
  tv.sustain(true);
  tv.noteOff('C4', 0.2); // held by the pedal
  tv.noteOn('C4', 0.3, undefined, 100); // restrike
  const v0 = tv.voices[0];
  const cut = gainHistory(v0).some(h => h.t === 'ramp' && Math.abs(h.v - 0.0001) < 1e-9);
  const ringing = tv.voices.filter(v => v.activeNote === 'C4');
  return cut && v0._sustainHeld === false && ringing.length === 1;
});

// ---- rendered sound (offline) --------------------------------------------------
function peakIn(ch, fromSec, toSec, rate) {
  let peak = 0;
  const from = Math.max(0, Math.floor(fromSec * rate));
  const to = Math.min(ch.length, Math.ceil(toSec * rate));
  for (let i = from; i < to; i++) {
    const v = Math.abs(ch[i]);
    if (v > peak) peak = v;
  }
  return peak;
}
function maxDeltaIn(ch, fromSec, toSec, rate) {
  let md = 0;
  const from = Math.max(0, Math.floor(fromSec * rate));
  const to = Math.min(ch.length - 1, Math.ceil(toSec * rate));
  for (let i = from; i < to; i++) {
    const d = Math.abs(ch[i + 1] - ch[i]);
    if (d > md) md = d;
  }
  return md;
}

check('rendered release during attack has no click', async () => {
  const rate = 44100;
  const ctx = new OfflineAudioContext(1, rate, rate);
  const tv = new TrackVoices(ctx, makeTrack({ a: 0.2, d: 0.2, s: 0.5, r: 0.15 }), ctx.destination);
  tv.noteOn('C4', 0, undefined, 100);
  tv.noteOff('C4', 0.05);
  const buf = await ctx.startRendering();
  const ch = buf.getChannelData(0);
  const md = maxDeltaIn(ch, 0.05, 0.15, rate);
  const tail = peakIn(ch, 0.5, 1.0, rate);
  const head = peakIn(ch, 0, 0.05, rate);
  return head > 0.05 && md < 0.05 && tail < 0.01;
});
check('rendered restrike re-attacks to full height', async () => {
  const rate = 44100;
  const ctx = new OfflineAudioContext(1, rate, rate);
  const tv = new TrackVoices(ctx, makeTrack({ a: 0.05, d: 0.1, s: 0.7, r: 0.15 }), ctx.destination);
  tv.noteOn('C4', 0, undefined, 100);
  tv.noteOn('C4', 0.3, undefined, 100);
  const buf = await ctx.startRendering();
  const ch = buf.getChannelData(0);
  const first = peakIn(ch, 0, 0.15, rate);
  const second = peakIn(ch, 0.3, 0.5, rate);
  return first > 0.05 && second > 0.5 * first;
});

(async () => {
  for (const t of queue) {
    try {
      const r = await t.fn();
      if (r === false) throw new Error('assertion returned false');
      passed.push(t.name);
      const li = document.createElement('li');
      li.textContent = 'PASS  ' + t.name;
      results.appendChild(li);
    } catch (err) {
      failed.push(t.name);
      const li = document.createElement('li');
      li.className = 'fail';
      li.textContent = 'FAIL  ' + t.name + ': ' + err.message;
      results.appendChild(li);
    }
  }
  summary.textContent = 'SUMMARY: ' + passed.length + ' passed, ' + failed.length + ' failed';
  if (failed.length > 0) {
    summary.style.color = '#ff4444';
    summary.textContent += ' — ' + failed.join(', ');
  }
})();
