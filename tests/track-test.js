import { createMockAudioContext } from './mockAudioContext.js';
import {
  createTrackEngine,
  defaultTrackConfig,
  STEPS_PER_LOOP,
} from '../src/tracks/trackEngine.js';
import { setClipAudioCommand } from '../src/project/trackCommands.js';

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

// Deterministic scheduler driver: fake clock advanced manually, no real timer.
function makeFixture(bpm = 120) {
  const ctx = createMockAudioContext();
  let now = 0;
  // Fake clip-audio engine: records playClip/stopAll calls deterministically
  // (real AudioBufferSources cannot run on the mock context).
  const audioCalls = [];
  const fakeAudio = {
    calls: audioCalls,
    async playClip(args) { audioCalls.push({ ...args }); return { stop() {} }; },
    stopAll() { audioCalls.push({ stopAll: true }); },
  };
  const engine = createTrackEngine(ctx, ctx.destination, { bpm, audioEngine: fakeAudio });
  engine._setClock(() => now);
  const track = engine.addTrack({ name: 'T1', id: 'trk_a' });
  engine.activeTrackId = 'trk_a';
  const spy = [];
  const origOn = track.voice.noteOn.bind(track.voice);
  track.voice.noteOn = (note, at, dur, vel) => { spy.push({ note, at, dur, vel, type: 'on' }); origOn(note, at, dur, vel); };
  const origOff = track.voice.noteOff.bind(track.voice);
  track.voice.noteOff = (note, at) => { spy.push({ note, at, type: 'off' }); origOff(note, at); };
  const driver = {
    engine, track, ctx, spy, audioCalls,
    set(ms) { now = ms; },
    play() {
      engine.play();
      engine.stopTimer(); // we drive _tick() ourselves
    },
    record() {
      engine.record();
      engine.stopTimer();
    },
    advanceAndTick(deltaMs) { now += deltaMs; engine._tick(); },
  };
  return driver;
}

check('addTrack registers a track with a voice chain', () => {
  const d = makeFixture();
  return !!d.track && d.engine.byId.trk_a === d.track && !!d.track.voice;
});

check('stepDur/loopDur derived from BPM', () => {
  const d = makeFixture(120);
  const at60 = createTrackEngine(d.ctx, d.ctx.destination, { bpm: 60 });
  at60.recalcTempo();
  const ok = Math.abs(at60.stepDur - 0.25) < 1e-6 && Math.abs(at60.loopDur - 4) < 1e-6;
  at60.dispose();
  return ok && Math.abs(d.engine.stepDur - 0.125) < 1e-6;
});

check('toggleGridStep toggles on then off', () => {
  const d = makeFixture();
  d.engine.toggleGridStep('trk_a', 3, 'E4');
  const on = d.track.grid[3];
  if (!on || on.note !== 'E4' || on.dur !== 1) return false;
  d.engine.toggleGridStep('trk_a', 3);
  return d.track.grid[3] === null;
});

check('toggleGridStep stores per-cell note and duration', () => {
  const d = makeFixture();
  d.engine.setGridDur('trk_a', 2);
  d.engine.toggleGridStep('trk_a', 5, 'G3', 3);
  const c = d.track.grid[5];
  return c && c.note === 'G3' && c.dur === 3;
});

check('setGridStep edits pitch and duration of a cell', () => {
  const d = makeFixture();
  d.engine.toggleGridStep('trk_a', 0, 'C4');
  d.engine.setGridStep('trk_a', 0, { note: 'E4', dur: 2 });
  const c = d.track.grid[0];
  return c && c.note === 'E4' && c.dur === 2;
});

check('legacy string grid cells normalize to {note,dur}', () => {
  const d = makeFixture();
  d.track.grid[0] = 'C4';
  d.track.grid[1] = null;
  const t = d.engine.getTracks()[0];
  return t.grid[0] && t.grid[0].note === 'C4' && t.grid[0].dur === 1 && t.grid[1] === null;
});

check('grid playback uses per-cell duration', () => {
  const d = makeFixture(120);
  d.engine.toggleGridStep('trk_a', 0, 'C4', 4);
  d.play();
  d.advanceAndTick(100); // elapsed 0.1s
  const hit = d.spy.find(s => s.note === 'C4');
  const expected = 0.125 * 4 - 0.01; // 4 steps minus the 10ms guard
  return !!hit && Math.abs(hit.dur - expected) < 1e-6;
});

check('play schedules grid notes ahead on the Web Audio clock', () => {
  const d = makeFixture(120);
  d.engine.toggleGridStep('trk_a', 0, 'C4');
  d.play();
  d.advanceAndTick(100); // elapsed 0.1s
  const hit = d.spy.find(s => s.note === 'C4');
  return !!hit && Math.abs(hit.at - 0.03) < 1e-6 && (hit.dur === undefined ? true : hit.dur > 0);
});

check('grid steps advance monotonically across ticks', () => {
  const d = makeFixture(120);
  d.engine.toggleGridStep('trk_a', 1, 'C4');
  d.play();
  const times = [];
  for (let i = 0; i < 5; i++) {
    d.advanceAndTick(10);
    d.spy.forEach(s => { if (s.note === 'C4') times.push(s.at); });
  }
  const unique = [...new Set(times.map(t => Math.round(t * 1000)))];
  return unique.length >= 1 && unique.every((t, i, arr) => i === 0 || t > arr[i - 1]);
});

check('record captures noteOn/noteOff as a realtime segment', () => {
  const d = makeFixture(120);
  d.record();
  d.advanceAndTick(1000); // loopPos ~1.0s
  d.engine.noteOn('C4');
  d.advanceAndTick(500);  // loopPos ~1.5s
  d.engine.noteOff('C4');
  d.engine.stop();
  const rt = d.track.rt;
  return rt.length === 1 && rt[0].note === 'C4'
    && Math.abs(rt[0].start - 1.0) < 0.02 && Math.abs(rt[0].dur - 0.5) < 0.02;
});

check('recording auto-arms the active track', () => {
  const d = makeFixture(120);
  d.record();
  return d.engine.isArmed('trk_a');
});

check('held note commits at stop with dur to loop end', () => {
  const d = makeFixture(120);
  d.record();
  d.advanceAndTick(1000);
  d.engine.noteOn('C4');
  d.engine.stop(); // never released
  const rt = d.track.rt;
  return rt.length === 1 && rt[0].note === 'C4' && Math.abs(rt[0].start - 1.0) < 0.02
    && Math.abs(rt[0].dur - 1.0) < 0.05;
});

check('playback triggers recorded rt notes at their loop time', () => {
  const d = makeFixture(120);
  d.engine.toggleGridStep('trk_a', 0, 'C4');
  d.record();
  d.advanceAndTick(1000);
  d.engine.noteOn('E4');
  d.advanceAndTick(500);
  d.engine.noteOff('E4');
  d.engine.stop();
  d.spy.length = 0;

  d.play();
  let sawE4 = false;
  for (let i = 0; i < 12; i++) {
    d.advanceAndTick(200); // ~1.6s → wraps loop, covers t=1.0s rt event
    if (d.spy.some(s => s.note === 'E4' && s.dur !== undefined && s.dur > 0)) sawE4 = true;
  }
  return sawE4;
});

check('loop wrap fires onLoopWrap and restarts grid cursor', () => {
  const d = makeFixture(120);
  let wraps = 0;
  d.engine.onLoopWrap = () => wraps++;
  d.play();
  d.advanceAndTick(1000);
  d.advanceAndTick(1000); // 2s elapsed = exactly one loop
  d.advanceAndTick(50);
  return wraps >= 1;
});

check('updateTrack mutates wave/filter/adsr config', () => {
  const d = makeFixture(120);
  d.engine.updateTrack('trk_a', { wave: 'sawtooth', filterType: 'lowpass', filterFreq: 800, adsr: { a: 0.02 } });
  const t = d.track;
  return t.wave === 'sawtooth' && t.filterType === 'lowpass' && t.filterFreq === 800 && t.adsr.a === 0.02;
});

check('clearTrack empties grid and rt', () => {
  const d = makeFixture(120);
  d.engine.toggleGridStep('trk_a', 0, 'C4');
  d.record();
  d.advanceAndTick(500);
  d.engine.noteOn('C4');
  d.engine.stop();
  if (!d.track.rt.length) return false;
  d.engine.clearTrack('trk_a');
  return d.track.grid.every(s => s === null) && d.track.rt.length === 0;
});

check('removeTrack disposes voice and removes id', () => {
  const d = makeFixture(120);
  const id = d.track.id;
  d.engine.removeTrack(id);
  return !d.engine.byId[id] && d.engine.tracks.length === 0;
});

check('getState reports transport + position', () => {
  const d = makeFixture(120);
  d.play();
  d.advanceAndTick(500);
  const s = d.engine.getState();
  const ok = s.playing === true && Math.abs(s.loopPos - 0.5) < 0.02 && s.step === 4 && s.bpm === 120;
  d.engine.stop();
  const after = d.engine.getState();
  return ok && after.playing === false && after.recording === false;
});

// ---- MIDI clip event sync (backlog #9) -----------------------------------
check('addClip creates a loop clip and syncs grid events into it', () => {
  const d = makeFixture(120);
  d.engine.toggleGridStep('trk_a', 0, 'C4');
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  const clip = d.track.clips.find(c => c.start === 0);
  return !!clip && clip.events.length === 1
    && clip.events[0].note === 'C4' && clip.events[0].start === 0 && clip.events[0].dur === 120;
});

check('loop clip events mirror grid step at 8', () => {
  const d = makeFixture(120);
  d.engine.toggleGridStep('trk_a', 8, 'E4', 2);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  const clip = d.track.clips.find(c => c.start === 0);
  return !!clip && clip.events[0].note === 'E4' && clip.events[0].start === 8 * 120 && clip.events[0].dur === 240;
});

check('loop clip events include recorded rt notes in ticks', () => {
  const d = makeFixture(120);
  d.record();
  d.advanceAndTick(1000);
  d.engine.noteOn('E4');
  d.advanceAndTick(500);
  d.engine.noteOff('E4');
  d.engine.stop();
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  const clip = d.track.clips.find(c => c.start === 0);
  const rtEv = clip.events.find(e => e.note === 'E4');
  return !!rtEv && Math.abs(rtEv.start - 1.0 * 960) < 20 && Math.abs(rtEv.dur - 0.5 * 960) < 20;
});

check('grid edits re-sync the loop clip events', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  d.engine.toggleGridStep('trk_a', 2, 'G3');
  const clip = d.track.clips.find(c => c.start === 0);
  return clip.events.length === 1 && clip.events[0].note === 'G3' && clip.events[0].start === 2 * 120;
});

check('clearTrack empties the loop clip events', () => {
  const d = makeFixture(120);
  d.engine.toggleGridStep('trk_a', 0, 'C4');
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  d.engine.clearTrack('trk_a');
  const clip = d.track.clips.find(c => c.start === 0);
  return clip.events.length === 0;
});

check('getTracks returns clip events sorted by tick', () => {
  const d = makeFixture(120);
  d.engine.toggleGridStep('trk_a', 4, 'C4');
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  const t = d.engine.getTracks()[0];
  const clip = t.clips.find(c => c.start === 0);
  const starts = clip.events.map(e => e.start);
  return starts.every((s, i) => i === 0 || s >= starts[i - 1]);
});

check('track restored with clip events derives grid/rt for playback', () => {
  const d = makeFixture(120);
  const cfg = {
    id: 'trk_restored',
    grid: Array(16).fill(null),
    rt: [],
    clips: [{ id: 'clip_a', name: 'Loop', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }] }],
  };
  const t = d.engine.addTrack(cfg);
  return t.grid[0] && t.grid[0].note === 'C4' && t.grid[0].dur === 1;
});

check('track restored with clip rt events derives rt in seconds', () => {
  const d = makeFixture(120);
  const cfg = {
    id: 'trk_rt',
    grid: Array(16).fill(null),
    rt: [],
    clips: [{ id: 'clip_b', name: 'Loop', start: 0, length: 1920, events: [{ note: 'E4', start: 480, dur: 240 }] }],
  };
  const t = d.engine.addTrack(cfg);
  return t.rt.length === 1 && Math.abs(t.rt[0].start - 0.5) < 1e-6 && Math.abs(t.rt[0].dur - 0.25) < 1e-6;
});

check('non-loop clip events are left untouched by the loop sync', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  d.engine.addClip('trk_a', { id: 'clip_c', start: 1920, length: 1920, events: [{ note: 'B2', start: 0, dur: 120 }] });
  const clip = d.track.clips.find(c => c.id === 'clip_c');
  return clip.events.length === 1 && clip.events[0].note === 'B2';
});

check('setClipEvents on the loop clip re-derives grid and clears rt', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  d.engine.setClipEvents('trk_a', d.track.clips[0].id, [{ note: 'C4', start: 0, dur: 120 }, { note: 'D4', start: 360, dur: 120 }]);
  return d.track.grid[0] && d.track.grid[0].note === 'C4'
    && d.track.grid[3] && d.track.grid[3].note === 'D4' && d.track.grid[3].dur === 1
    && d.track.rt.length === 0;
});

check('setClipEvents on a non-loop clip does not touch grid/rt', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  d.engine.addClip('trk_a', { id: 'clip_n', start: 1920, length: 1920 });
  d.engine.setClipEvents('trk_a', 'clip_n', [{ note: 'A3', start: 0, dur: 240 }]);
  const clip = d.track.clips.find(c => c.id === 'clip_n');
  const loop = d.track.clips.find(c => c.start === 0);
  return clip.events.length === 1 && clip.events[0].note === 'A3' && clip.events[0].dur === 240
    && d.track.grid.every(c => c === null) && d.track.rt.length === 0 && loop.events.length === 0;
});

check('setClipEvents sorts and copies events (no caller aliasing)', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  const events = [{ note: 'G4', start: 1200, dur: 120 }, { note: 'C4', start: 0, dur: 120 }];
  d.engine.setClipEvents('trk_a', d.track.clips[0].id, events);
  events.push({ note: 'E4', start: 480, dur: 120 });
  const clip = d.track.clips.find(c => c.start === 0);
  return clip.events.length === 2 && clip.events[0].start === 0 && clip.events[1].start === 1200;
});

check('setClipEvents on a missing clip is a no-op', () => {
  const d = makeFixture(120);
  return d.engine.setClipEvents('trk_a', 'nope', [{ note: 'C4', start: 0, dur: 120 }]) === false;
});

check('a grid edit after a piano-roll edit re-syncs loop events', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  d.engine.setClipEvents('trk_a', d.track.clips[0].id, [{ note: 'C4', start: 0, dur: 120 }]);
  d.engine.toggleGridStep('trk_a', 8, 'E4');
  const clip = d.track.clips.find(c => c.start === 0);
  return clip.events.some(e => e.note === 'E4' && e.start === 8 * 120)
    && d.track.grid[8] && d.track.grid[8].note === 'E4';
});

check('setClipEvents preserves velocity through the loop grid round-trip', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  d.engine.setClipEvents('trk_a', d.track.clips[0].id, [{ note: 'C4', start: 0, dur: 120, velocity: 64 }]);
  // setClipEvents re-quantizes into grid (cell gains vel); the restore path
  // (addTrack) and getTracks re-derive events via syncLoopClip -> gridToClipEvents,
  // so the velocity survives the round-trip.
  const track = d.engine.getTracks().find(t => t.id === 'trk_a');
  const clip = track.clips.find(c => c.start === 0);
  return d.track.grid[0].vel === 64
    && clip.events.length === 1 && clip.events[0].velocity === 64;
});

check('addClip without a start defaults to the loop position', () => {
  const d = makeFixture(120);
  const clip = d.engine.addClip('trk_a', {});
  return clip.start === 0;
});

check('splitClip splits a clip in two and partitions events', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0 }); // loop clip first, so sync targets it
  d.engine.addClip('trk_a', { id: 'clip_s', start: 1920, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }, { note: 'G4', start: 1200, dur: 120 }] });
  const right = d.engine.splitClip('trk_a', 'clip_s', 2880);
  const clips = d.track.clips;
  const left = clips.find(c => c.id === 'clip_s');
  return right !== null
    && clips.length === 3
    && left.length === 960 && left.events.length === 1 && left.events[0].start === 0
    && right.start === 2880 && right.length === 960 && right.events.length === 1 && right.events[0].start === 240;
});

check('splitClip outside the clip bounds returns null', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0 });
  d.engine.addClip('trk_a', { id: 'clip_s', start: 1920, length: 1920, events: [] });
  const r1 = d.engine.splitClip('trk_a', 'clip_s', 1920);
  const r2 = d.engine.splitClip('trk_a', 'clip_s', 3840);
  const r3 = d.engine.splitClip('trk_a', 'clip_s', 5000);
  return r1 === null && r2 === null && r3 === null && d.track.clips.length === 2;
});

check('duplicateClip copies the clip right after the original', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0 });
  d.engine.addClip('trk_a', { id: 'clip_d', start: 960, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }] });
  const copy = d.engine.duplicateClip('trk_a', 'clip_d');
  return copy !== null
    && d.track.clips.length === 3
    && copy.start === 2880 && copy.length === 1920
    && copy.events.length === 1 && copy.events[0].note === 'C4';
});

check('repeatClip loops a clip 3x back-to-back', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0 });
  d.engine.addClip('trk_a', { id: 'clip_r', start: 1920, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }] });
  const copies = d.engine.repeatClip('trk_a', 'clip_r', 3);
  return copies.length === 2
    && d.track.clips.length === 4
    && copies[0].start === 3840 && copies[1].start === 5760
    && copies[0].length === 1920 && copies[0].events.length === 1;
});

check('repeatClip with times <= 1 adds nothing', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0 });
  d.engine.addClip('trk_a', { id: 'clip_r', start: 1920, length: 1920, events: [] });
  const copies = d.engine.repeatClip('trk_a', 'clip_r', 1);
  return copies.length === 0 && d.track.clips.length === 2;
});

check('splitClip on the loop clip keeps the loop events in sync', () => {
  const d = makeFixture(120);
  d.engine.toggleGridStep('trk_a', 4);
  d.engine.addClip('trk_a', {});
  const right = d.engine.splitClip('trk_a', d.track.clips[0].id, 960);
  const loop = d.track.clips.find(c => c.start === 0);
  return right !== null && loop.events.length >= 1 && loop.length === 960;
});

// ---- mute / solo (backlog #17) -------------------------------------------
check('defaultTrackConfig starts unmuted and unsoloed', () => {
  const d = makeFixture(120);
  return d.track.muted === false && d.track.solo === false;
});

check('updateTrack toggles muted and solo flags', () => {
  const d = makeFixture(120);
  d.engine.updateTrack('trk_a', { muted: true, solo: false });
  const muted = d.track.muted === true && d.engine.isAudible('trk_a') === false;
  d.engine.updateTrack('trk_a', { muted: false, solo: true });
  return muted && d.track.solo === true && d.engine.isAudible('trk_a') === true;
});

check('solo mutes every other track', () => {
  const d = makeFixture(120);
  d.engine.addTrack({ id: 'trk_b', name: 'B' });
  d.engine.addTrack({ id: 'trk_c', name: 'C' });
  d.engine.updateTrack('trk_b', { solo: true });
  return d.engine.isAudible('trk_a') === false
    && d.engine.isAudible('trk_b') === true
    && d.engine.isAudible('trk_c') === false;
});

check('unsoloing the last solo restores audibility for all', () => {
  const d = makeFixture(120);
  d.engine.addTrack({ id: 'trk_b', name: 'B' });
  d.engine.updateTrack('trk_b', { solo: true });
  d.engine.updateTrack('trk_b', { solo: false });
  return d.engine.isAudible('trk_a') === true && d.engine.isAudible('trk_b') === true;
});

check('muted track stays inaudible even when soloed elsewhere', () => {
  const d = makeFixture(120);
  d.engine.addTrack({ id: 'trk_b', name: 'B' });
  d.engine.updateTrack('trk_a', { muted: true });
  d.engine.updateTrack('trk_b', { solo: true });
  return d.engine.isAudible('trk_a') === false && d.engine.isAudible('trk_b') === true;
});

check('mute/solo flags are included in getTracks', () => {
  const d = makeFixture(120);
  d.engine.updateTrack('trk_a', { muted: true, solo: true });
  const t = d.engine.getTracks().find(x => x.id === 'trk_a');
  return t && t.muted === true && t.solo === true;
});

check('setGain clamps volume to [0,1]', () => {
  const d = makeFixture(120);
  const v = d.track.voice;
  v.setGain(1.7);
  const high = v.trackGain.gain.value;
  v.setGain(-0.4);
  const low = v.trackGain.gain.value;
  return high === 1 && low === 0;
});

check('audibility applies a gain of zero to muted tracks', () => {
  const d = makeFixture(120);
  d.engine.updateTrack('trk_a', { muted: true });
  return d.track.voice.trackGain.gain.value === 0;
});

check('audibility restores volume after unmute', () => {
  const d = makeFixture(120);
  d.engine.updateTrack('trk_a', { muted: true });
  d.engine.updateTrack('trk_a', { muted: false });
  return d.track.voice.trackGain.gain.value === d.track.volume;
});

// ---- track reorder (backlog #19) ------------------------------------------
check('reorderTrack moves a track to a lower index', () => {
  const d = makeFixture(120);
  d.engine.addTrack({ id: 'trk_b', name: 'B' });
  d.engine.addTrack({ id: 'trk_c', name: 'C' });
  const ok = d.engine.reorderTrack('trk_c', 0);
  const order = d.engine.tracks.map(t => t.id).join(',');
  return ok === true && order === 'trk_c,trk_a,trk_b';
});

check('reorderTrack moves a track to a higher index', () => {
  const d = makeFixture(120);
  d.engine.addTrack({ id: 'trk_b', name: 'B' });
  d.engine.addTrack({ id: 'trk_c', name: 'C' });
  const ok = d.engine.reorderTrack('trk_a', 2);
  const order = d.engine.tracks.map(t => t.id).join(',');
  return ok === true && order === 'trk_b,trk_c,trk_a';
});

check('reorderTrack clamps out-of-range target and keeps byId in sync', () => {
  const d = makeFixture(120);
  d.engine.addTrack({ id: 'trk_b', name: 'B' });
  d.engine.reorderTrack('trk_a', 99);
  const order = d.engine.tracks.map(t => t.id).join(',');
  const idsOk = d.engine.tracks.every(t => d.engine.byId[t.id] === t);
  return order === 'trk_b,trk_a' && idsOk;
});

check('reorderTrack is a no-op when already in place or missing', () => {
  const d = makeFixture(120);
  d.engine.addTrack({ id: 'trk_b', name: 'B' });
  const same = d.engine.reorderTrack('trk_a', 0);
  const missing = d.engine.reorderTrack('nope', 0);
  return same === false && missing === false && d.engine.tracks.length === 2;
});

check('reorderTrack preserves track data through the move', () => {
  const d = makeFixture(120);
  d.engine.addTrack({ id: 'trk_b', name: 'B' });
  d.engine.updateTrack('trk_a', { gridNote: 'E4', muted: true });
  d.engine.reorderTrack('trk_a', 1);
  const t = d.engine.byId.trk_a;
  return t.gridNote === 'E4' && t.muted === true && d.engine.tracks[1] === t;
});

// ---- track folders / collapse (backlog #23) -------------------------------
check('defaultTrackConfig starts with no folder and not collapsed', () => {
  const d = makeFixture(120);
  return d.track.folder === null && d.track.collapsed === false;
});

check('updateTrack sets folder and collapsed flags', () => {
  const d = makeFixture(120);
  d.engine.updateTrack('trk_a', { folder: 'trk_b', collapsed: true });
  return d.track.folder === 'trk_b' && d.track.collapsed === true;
});

check('folderChildren returns only direct children', () => {
  const d = makeFixture(120);
  d.engine.addTrack({ id: 'trk_b', name: 'B', folder: 'trk_a' });
  d.engine.addTrack({ id: 'trk_c', name: 'C', folder: 'trk_a' });
  d.engine.addTrack({ id: 'trk_d', name: 'D' });
  return d.engine.folderChildren('trk_a').map(t => t.id).sort().join(',') === 'trk_b,trk_c';
});

check('visibleTracks hides children of a collapsed folder', () => {
  const d = makeFixture(120);
  d.engine.addTrack({ id: 'trk_b', name: 'B', folder: 'trk_a' });
  d.engine.addTrack({ id: 'trk_c', name: 'C' });
  const allVisible = d.engine.visibleTracks().length === 3;
  d.engine.updateTrack('trk_a', { collapsed: true });
  const collapsedVisible = d.engine.visibleTracks().map(t => t.id).sort().join(',') === 'trk_a,trk_c';
  return allVisible && collapsedVisible;
});

// ---- full-song playback of arranged clips (backlog #24) -------------------
// At bpm 120 / ppq 480 one tick is 1/960 s; a clip at start 1920 ticks starts
// 2.0s after play (audio time 0.03 + 2.0 = 2.03). The lookahead is 0.12s, so
// an event enters the scheduling window when elapsed > absSec - 0.12.
// Like the app, a track gets a loop clip at start 0 first (the grid/rt mirror);
// arranged clips land later on the timeline.
function songFixture(bpm = 120) {
  const d = makeFixture(bpm);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  return d;
}

check('loop clip is not scheduled twice by the linear scheduler', () => {
  const d = makeFixture(120);
  d.engine.toggleGridStep('trk_a', 0, 'C4');
  d.play();
  d.advanceAndTick(100); // elapsed 0.1s
  return d.spy.filter(s => s.note === 'C4').length === 1;
});

check('arranged clip plays its events once at the right timeline times', () => {
  const d = songFixture(120);
  d.engine.addClip('trk_a', {
    start: 1920, length: 1920,
    events: [{ note: 'A3', start: 0, dur: 240 }, { note: 'B3', start: 240, dur: 120 }],
  });
  d.play();
  d.set(1500); d.engine._tick(); // before the clip start -> nothing
  const earlyA = d.spy.filter(s => s.note === 'A3').length;
  const earlyB = d.spy.filter(s => s.note === 'B3').length;
  d.set(1900); d.engine._tick(); // A3 in window, B3 (at 2.25s) not yet
  const a = d.spy.filter(s => s.note === 'A3');
  const bAt1900 = d.spy.filter(s => s.note === 'B3').length;
  d.set(2600); d.engine._tick(); // B3 now in window
  const b = d.spy.filter(s => s.note === 'B3');
  d.advanceAndTick(600); // later passes must not reschedule
  const aAfter = d.spy.filter(s => s.note === 'A3').length;
  const bAfter = d.spy.filter(s => s.note === 'B3').length;
  const aOk = a.length === 1 && Math.abs(a[0].at - 2.03) < 1e-6 && Math.abs(a[0].dur - 0.25) < 1e-6;
  const bOk = b.length === 1 && Math.abs(b[0].at - 2.28) < 1e-6 && Math.abs(b[0].dur - 0.125) < 1e-6;
  return earlyA === 0 && earlyB === 0 && aOk && bAt1900 === 0 && bOk && aAfter === 1 && bAfter === 1;
});

check('enabled:false track skips arranged clips', () => {
  const d = songFixture(120);
  d.track.enabled = false;
  d.engine.addClip('trk_a', { start: 1920, length: 1920, events: [{ note: 'A3', start: 0, dur: 240 }] });
  d.play();
  d.set(1900); d.engine._tick();
  return d.spy.filter(s => s.note === 'A3').length === 0;
});

check('arranged clips replay after stop and restart', () => {
  const d = songFixture(120);
  d.engine.addClip('trk_a', { start: 1920, length: 1920, events: [{ note: 'A3', start: 0, dur: 240 }] });
  d.play();
  d.set(2000); d.engine._tick();
  const first = d.spy.filter(s => s.note === 'A3').length;
  d.engine.stop();
  d.play();
  d.set(3900); d.engine._tick(); // elapsed 1.9s after the second start
  const second = d.spy.filter(s => s.note === 'A3').length;
  return first === 1 && second === 2;
});

check('arranged clip with no duration schedules an open note', () => {
  const d = songFixture(120);
  d.engine.addClip('trk_a', { start: 1920, length: 1920, events: [{ note: 'A3', start: 0 }] });
  d.play();
  d.set(1900); d.engine._tick();
  const hit = d.spy.find(s => s.note === 'A3');
  return !!hit && Math.abs(hit.at - 2.03) < 1e-6 && hit.dur === undefined;
});

// ---- audible velocity (backlog #28) ----------------------------------------
// Velocity (0-127, model default 100) scales the per-voice envelope: attack peak
// and sustain are multiplied by vel/127. The mock AudioParam records every
// scheduled value into `_history`, so the tests assert the scaled attack ramp
// and the scaled sustain ramp actually reached the envelope gain param.
function envHistory(d, idx) {
  return (d.track.voice.voices[idx] || {}).env.gain._history || [];
}
function sawRamp(hist, v) {
  return hist.some(h => h.t === 'ramp' && Math.abs(h.v - v) < 1e-6);
}
check('grid cell velocity scales the voice envelope gain', () => {
  const d = makeFixture(120);
  d.track.grid[0] = { note: 'C4', dur: 1, vel: 64 };
  d.play();
  d.advanceAndTick(100); // step 0 plays at 0.03s, well inside the lookahead
  const hit = d.spy.find(s => s.note === 'C4');
  const hist = envHistory(d, 0);
  return !!hit && hit.vel === 64 && sawRamp(hist, 64 / 127) && sawRamp(hist, 0.7 * (64 / 127));
});

check('grid cells without velocity default to velocity 100', () => {
  const d = makeFixture(120);
  d.engine.toggleGridStep('trk_a', 0, 'C4');
  d.play();
  d.advanceAndTick(100);
  const hit = d.spy.find(s => s.note === 'C4');
  const hist = envHistory(d, 0);
  return !!hit && hit.vel === undefined && sawRamp(hist, 100 / 127) && sawRamp(hist, 0.7 * (100 / 127));
});

check('arranged clip event velocity reaches the voice and scales gain', () => {
  const d = songFixture(120);
  d.engine.addClip('trk_a', {
    start: 1920, length: 1920,
    events: [{ note: 'A3', start: 0, dur: 240, velocity: 32 }, { note: 'B3', start: 240, dur: 120, velocity: 127 }],
  });
  d.play();
  d.set(1900); d.engine._tick(); // A3 (2.03s) in window, B3 (2.28s) not yet
  const a = d.spy.find(s => s.note === 'A3');
  const bAt1900 = d.spy.filter(s => s.note === 'B3').length;
  d.set(2600); d.engine._tick(); // B3 now in window
  const b = d.spy.find(s => s.note === 'B3');
  return !!a && a.vel === 32 && bAt1900 === 0 && !!b && b.vel === 127;
});

check('loop clip mirrored from grid keeps per-cell velocity on playback', () => {
  const d = songFixture(120);
  const loopClip = d.engine.byId.trk_a.clips.find(c => c.start === 0);
  d.engine.setClipEvents('trk_a', loopClip.id, [{ note: 'C4', start: 0, dur: 120, velocity: 64 }]);
  d.play();
  d.advanceAndTick(100); // step 0 plays at 0.03s, well inside the lookahead
  const hit = d.spy.find(s => s.note === 'C4');
  const hist = envHistory(d, 0);
  return !!hit && hit.vel === 64 && sawRamp(hist, 64 / 127) && sawRamp(hist, 0.7 * (64 / 127));
});

// ---- piano roll audition (backlog #30) -----------------------------------

check('auditionNote plays through the requested track voice, open note', () => {
  const d = makeFixture(120);
  d.engine.auditionNote('trk_a', 'C4', 90);
  const hit = d.spy.find(s => s.note === 'C4');
  return !!hit && hit.dur === undefined && hit.vel === 90;
});

check('auditionNote honors mute/solo and bypasses the monitor flag', () => {
  const d = makeFixture(120);
  d.spy.length = 0;
  d.engine.updateTrack('trk_a', { muted: true });
  d.engine.auditionNote('trk_a', 'C4');
  const mutedSilent = !d.spy.some(s => s.note === 'C4');
  d.spy.length = 0;
  d.engine.updateTrack('trk_a', { muted: false, monitor: false });
  d.engine.auditionNote('trk_a', 'C4');
  const stillSounds = d.spy.some(s => s.note === 'C4');
  return mutedSilent && stillSounds;
});

check('auditionNote with a duration self-terminates the note', () => {
  const d = makeFixture(120);
  d.engine.auditionNote('trk_a', 'E4', 100, 0.25);
  const hit = d.spy.find(s => s.note === 'E4');
  return !!hit && hit.dur === 0.25;
});

check('auditionNote schedules ahead when a `when` time is given (backlog #40)', () => {
  const d = makeFixture(120);
  const at = d.engine.ctx.currentTime + 0.5;
  d.engine.auditionNote('trk_a', 'G4', 80, 0.2, at);
  const hit = d.spy.find(s => s.note === 'G4');
  return !!hit && hit.at === at && hit.dur === 0.2 && hit.vel === 80;
});

// ---- record mode + record quantization (backlog #41) ----------------------
check('record defaults to overdub mode with no record quantize', () => {
  const d = makeFixture(120);
  return d.engine.recordMode === 'overdub' && d.engine.recordQuantize === null;
});

check('REPLACE mode clears the loop clip before recording', () => {
  const d = makeFixture(120);
  d.engine.toggleGridStep('trk_a', 0, 'C4');
  d.engine.recordMode = 'replace';
  d.record();
  d.advanceAndTick(1000);
  d.engine.noteOn('E4');
  d.advanceAndTick(400);
  d.engine.noteOff('E4');
  d.engine.stop();
  return d.track.grid.every(c => c === null)
    && d.track.rt.length === 1 && d.track.rt[0].note === 'E4';
});

check('OVERDUB mode keeps existing clip notes while recording new ones', () => {
  const d = makeFixture(120);
  d.engine.toggleGridStep('trk_a', 0, 'C4');
  d.record();
  d.advanceAndTick(1000);
  d.engine.noteOn('E4');
  d.advanceAndTick(400);
  d.engine.noteOff('E4');
  d.engine.stop();
  return d.track.grid[0] && d.track.grid[0].note === 'C4'
    && d.track.rt.length === 1 && d.track.rt[0].note === 'E4';
});

check('record quantize snaps captured notes to the grid', () => {
  const d = makeFixture(120);
  d.engine.recordQuantize = { grid: 1, strength: 100, swing: 0 };
  d.record();
  d.advanceAndTick(1060); // loopPos 1.06s -> off-grid (nearest 16th is 1.0s)
  d.engine.noteOn('C4');
  d.advanceAndTick(200);
  d.engine.noteOff('C4');
  d.engine.stop();
  const rt = d.track.rt;
  return rt.length === 1 && Math.abs(rt[0].start - 1.0) < 0.02;
});

check('auditionNoteOff releases the auditioned note', () => {
  const d = makeFixture(120);
  const offSpy = [];
  const origOff = d.track.voice.noteOff.bind(d.track.voice);
  d.track.voice.noteOff = (note, at) => { offSpy.push({ note, at }); origOff(note, at); };
  d.engine.auditionNote('trk_a', 'C4');
  d.engine.auditionNoteOff('trk_a', 'C4');
  return offSpy.some(s => s.note === 'C4');
});

check('defaultTrackConfig starts with no inserts', () => {
  const t = defaultTrackConfig({ id: 'trk_i' });
  return Array.isArray(t.inserts) && t.inserts.length === 0;
});

check('addInsert appends a descriptor and rebuilds the chain', () => {
  const d = makeFixture();
  const ins = d.engine.addInsert('trk_a', 'delay');
  if (!ins || ins.type !== 'delay' || !ins.id || d.track.inserts.length !== 1) return false;
  const v = d.track.voice;
  if (v.inserts.length !== 1) return false;
  // voice env -> insertIn -> delay.input; delay.output -> trackGain (fader) -> dest
  const env = v.voices[0].env;
  const chained = v.inserts[0];
  return env._connections.has(v.insertIn)
    && v.insertIn._connections.has(chained.input)
    && chained.output._connections.has(v.trackGain);
});

check('addInsert fills default params for the type', () => {
  const d = makeFixture();
  const ins = d.engine.addInsert('trk_a', 'delay');
  if (ins.params.time !== 0.3 || ins.params.feedback !== 0.4 || ins.params.mix !== 0.3) return false;
  const rv = d.engine.addInsert('trk_a', 'reverb');
  return rv.params.mix === 0.3 && d.track.inserts.length === 2;
});

check('addInsert accepts explicit params', () => {
  const d = makeFixture();
  const ins = d.engine.addInsert('trk_a', 'delay', { time: 0.6, mix: 0.8 });
  return ins.params.time === 0.6 && ins.params.feedback === 0.4 && ins.params.mix === 0.8;
});

check('two inserts chain in order through the fader', () => {
  const d = makeFixture();
  d.engine.addInsert('trk_a', 'delay');
  d.engine.addInsert('trk_a', 'reverb');
  const v = d.track.voice;
  if (v.inserts.length !== 2) return false;
  const [delay, reverb] = v.inserts;
  return v.insertIn._connections.has(delay.input)
    && delay.output._connections.has(reverb.input)
    && reverb.output._connections.has(v.trackGain);
});

check('unknown insert types are skipped in the chain', () => {
  const d = makeFixture();
  d.track.inserts.push({ id: 'ins_x', type: 'bogus', params: {} });
  d.engine.updateTrack('trk_a', { inserts: d.track.inserts });
  const v = d.track.voice;
  return v.inserts.length === 0 && v.insertIn._connections.has(v.trackGain);
});

check('removeInsert drops the descriptor and rebuilds the chain', () => {
  const d = makeFixture();
  d.engine.addInsert('trk_a', 'delay');
  d.engine.addInsert('trk_a', 'reverb');
  const ok = d.engine.removeInsert('trk_a', 0);
  const v = d.track.voice;
  return ok && d.track.inserts.length === 1 && d.track.inserts[0].type === 'reverb'
    && v.inserts.length === 1
    && v.insertIn._connections.has(v.inserts[0].input)
    && v.inserts[0].output._connections.has(v.trackGain);
});

check('removeInsert on a missing index is a no-op', () => {
  const d = makeFixture();
  d.engine.addInsert('trk_a', 'delay');
  return d.engine.removeInsert('trk_a', 5) === false && d.track.inserts.length === 1;
});

check('updateInsert applies params to the live device', () => {
  const d = makeFixture();
  const ins = d.engine.addInsert('trk_a', 'delay');
  const ok = d.engine.updateInsert('trk_a', 0, { time: 0.75, mix: 0.5 });
  const dev = d.track.voice.inserts[0];
  return ok && ins.params.time === 0.75 && dev.delay.delayTime.value === 0.75
    && Math.abs(dev.dry.gain.value - 0.5) < 1e-9;
});

check('updateInsert leaves id and type immutable', () => {
  const d = makeFixture();
  const ins = d.engine.addInsert('trk_a', 'delay');
  d.engine.updateInsert('trk_a', 0, { id: 'hack', type: 'reverb', mix: 0.2 });
  return d.track.inserts[0].id === ins.id && d.track.inserts[0].type === 'delay';
});

check('getTracks includes insert descriptors as plain data', () => {
  const d = makeFixture();
  d.engine.addInsert('trk_a', 'delay', { mix: 0.6 });
  const t = d.engine.getTracks()[0];
  return Array.isArray(t.inserts) && t.inserts.length === 1
    && t.inserts[0].type === 'delay' && t.inserts[0].mix === undefined
    && t.inserts[0].params.mix === 0.6;
});

check('addTrack restores inserts from a saved track config', () => {
  const d = makeFixture();
  d.engine.addInsert('trk_a', 'reverb');
  const saved = d.engine.getTracks()[0];
  const t2 = d.engine.addTrack({ id: 'trk_b', name: 'B', inserts: saved.inserts });
  return t2.inserts.length === 1 && t2.inserts[0].type === 'reverb'
    && t2.voice.inserts.length === 1
    && t2.voice.insertIn._connections.has(t2.voice.inserts[0].input);
});

check('voices route through the insert chain before the fader', () => {
  const d = makeFixture();
  d.engine.addInsert('trk_a', 'delay');
  const v = d.track.voice;
  // every voice env feeds insertIn, never the fader directly
  return v.voices.every(vo => vo.env._connections.has(v.insertIn) && !vo.env._connections.has(v.trackGain));
});

check('audition still schedules when an insert is present', () => {
  const d = makeFixture(120);
  d.engine.addInsert('trk_a', 'delay');
  d.engine.auditionNote('trk_a', 'C4', 100, 0.25);
  return d.spy.some(s => s.note === 'C4');
});

// ---- chaseToTick ---------------------------------------------------------
check('chaseToTick fires noteOn for a sustained loop-clip note', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  d.engine.setClipEvents('trk_a', d.track.clips[0].id, [
    { note: 'C4', start: 240, dur: 240, velocity: 100 },
  ]);
  d.engine.play(); d.engine.stopTimer();
  d.set(500); d.engine._tick();
  d.spy.length = 0;
  // Chase at tick 360 — inside the note (240..480)
  d.engine.chaseToTick(360);
  return d.spy.length === 1 && d.spy[0].note === 'C4' && d.spy[0].dur > 0 && d.spy[0].dur < 0.25;
});
check('chaseToTick does not fire notes that ended before seek', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  d.engine.setClipEvents('trk_a', d.track.clips[0].id, [
    { note: 'C4', start: 0, dur: 120, velocity: 100 },
  ]);
  d.engine.play(); d.engine.stopTimer();
  d.set(500); d.engine._tick();
  d.spy.length = 0;
  d.engine.chaseToTick(240); // past end of note (0..120)
  return d.spy.length === 0;
});
check('chaseToTick does not fire notes that start after seek', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  d.engine.setClipEvents('trk_a', d.track.clips[0].id, [
    { note: 'C4', start: 480, dur: 120, velocity: 100 },
  ]);
  d.engine.play(); d.engine.stopTimer();
  d.set(500); d.engine._tick();
  d.spy.length = 0;
  d.engine.chaseToTick(240); // before start of note
  return d.spy.length === 0;
});
check('chaseToTick fires noteOn for a sustained arranged-clip note', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 }); // loop mirror
  d.engine.addClip('trk_a', { start: 1920, length: 1920, events: [
    { note: 'A3', start: 0, dur: 480, velocity: 100 },
  ]});
  d.engine.play(); d.engine.stopTimer();
  d.set(500); d.engine._tick();
  d.spy.length = 0;
  d.engine.chaseToTick(2160); // inside arranged note (1920..2400)
  return d.spy.length === 1 && d.spy[0].note === 'A3' && d.spy[0].dur > 0;
});
check('chaseToTick skips disabled tracks', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  d.engine.setClipEvents('trk_a', d.track.clips[0].id, [
    { note: 'C4', start: 240, dur: 240, velocity: 100 },
  ]);
  d.engine.updateTrack('trk_a', { enabled: false });
  d.engine.play(); d.engine.stopTimer();
  d.set(500); d.engine._tick();
  d.spy.length = 0;
  d.engine.chaseToTick(360);
  return d.spy.length === 0;
});
check('chaseToTick is no-op when not playing', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  d.engine.setClipEvents('trk_a', d.track.clips[0].id, [
    { note: 'C4', start: 240, dur: 240, velocity: 100 },
  ]);
  // Not playing — chase should do nothing
  d.engine.chaseToTick(360);
  return d.spy.length === 0;
});

// --- MIDI channel routing (backlog #173) ---
check('addTrack includes midiChannel null by default', () => {
  const d = makeFixture(120);
  d.engine.addTrack({ id: 'trk_def' });
  const t = d.engine.byId['trk_def'];
  return t && t.midiChannel === null;
});
check('addTrack preserves midiChannel from config', () => {
  const d = makeFixture(120);
  d.engine.addTrack({ id: 'trk_ch1', name: 'Ch1', midiChannel: 5 });
  const t = d.engine.byId['trk_ch1'];
  return t && t.midiChannel === 5;
});
check('updateTrack sets midiChannel', () => {
  const d = makeFixture(120);
  d.engine.updateTrack('trk_a', { midiChannel: 10 });
  return d.track.midiChannel === 10;
});
check('getTracks includes midiChannel', () => {
  const d = makeFixture(120);
  d.engine.updateTrack('trk_a', { midiChannel: 3 });
  const tracks = d.engine.getTracks();
  const found = tracks.find(t => t.id === 'trk_a');
  return found && found.midiChannel === 3;
});
check('noteOn routes to active track voice when no armed tracks', () => {
  const d = makeFixture(120);
  d.spy.length = 0;
  d.engine.noteOn('C4');
  return d.spy.length === 1 && d.spy[0].note === 'C4';
});
check('noteOff routes to active track voice when no armed tracks', () => {
  const d = makeFixture(120);
  d.engine.noteOn('C4');
  d.spy.length = 0;
  d.engine.noteOff('C4');
  return d.spy.length === 1 && d.spy[0].note === 'C4';
});

// --- Pitch bend / modulation / sustain (backlog #174) ---
check('voice.pitchBend shifts oscillator frequency up', () => {
  const d = makeFixture(120);
  d.engine.noteOn('C4');
  const v = d.track.voice;
  const beforeFreq = v.voices.find(x => x.activeNote === 'C4')?.osc?.frequency?.value;
  v.pitchBend(1.0); // +2 semitones
  const afterFreq = v.voices.find(x => x.activeNote === 'C4')?.osc?.frequency?.value;
  return beforeFreq !== undefined && afterFreq > beforeFreq;
});
check('voice.pitchBend shifts oscillator frequency down', () => {
  const d = makeFixture(120);
  d.engine.noteOn('C4');
  const v = d.track.voice;
  const beforeFreq = v.voices.find(x => x.activeNote === 'C4')?.osc?.frequency?.value;
  v.pitchBend(-1.0); // -2 semitones
  const afterFreq = v.voices.find(x => x.activeNote === 'C4')?.osc?.frequency?.value;
  return beforeFreq !== undefined && afterFreq < beforeFreq;
});
check('voice.pitchBend zero restores base frequency', () => {
  const d = makeFixture(120);
  d.engine.noteOn('C4');
  const v = d.track.voice;
  const baseFreq = v.voices.find(x => x.activeNote === 'C4')?.osc?.frequency?.value;
  v.pitchBend(1.0);
  v.pitchBend(0);
  const restored = v.voices.find(x => x.activeNote === 'C4')?.osc?.frequency?.value;
  return Math.abs(restored - baseFreq) < 1;
});
check('voice.noteOn applies current pitch bend', () => {
  const d = makeFixture(120);
  const v = d.track.voice;
  v.pitchBend(1.0);
  d.engine.noteOn('C4');
  const freq = v.voices.find(x => x.activeNote === 'C4')?.osc?.frequency?.value;
  const baseFreq = 261.63; // C4
  // +2 semitones = baseFreq * 2^(2/12) ≈ baseFreq * 1.1225
  return freq > baseFreq * 1.1;
});
check('voice.sustain holds noteOff', () => {
  const d = makeFixture(120);
  d.engine.noteOn('C4');
  const v = d.track.voice;
  v.sustain(true);
  d.engine.noteOff('C4');
  // Voice should still be active (sustain held)
  const active = v.voices.find(x => x.activeNote === 'C4');
  return !!active && active._sustainHeld === true;
});
check('voice.sustain release frees held voices', () => {
  const d = makeFixture(120);
  d.engine.noteOn('C4');
  const v = d.track.voice;
  v.sustain(true);
  d.engine.noteOff('C4');
  v.sustain(false);
  // After sustain release, voice should no longer be active
  const held = v.voices.find(x => x.activeNote === 'C4' && x._sustainHeld);
  return !held;
});
check('voice.modulation adjusts filter frequency', () => {
  const d = makeFixture(120);
  d.engine.updateTrack('trk_a', { filterType: 'lowpass', filterFreq: 1200 });
  d.engine.noteOn('C4');
  const v = d.track.voice;
  v.modulation(1.0);
  // Filter freq should now be higher (towards 20000)
  const filterFreq = v.voices.find(x => x.activeNote === 'C4')?.filter?.frequency?.value;
  return filterFreq > 1200;
});
check('engine.routeCC routes CC1 to modulation on matching tracks', () => {
  const d = makeFixture(120);
  d.engine.updateTrack('trk_a', { filterType: 'lowpass', filterFreq: 1200 });
  d.engine.noteOn('C4');
  d.engine.routeCC(null, 1, 127); // CC1, all channels
  const v = d.track.voice;
  const freq = v.voices.find(x => x.activeNote === 'C4')?.filter?.frequency?.value;
  return freq > 1200;
});
check('engine.routeCC routes CC64 to sustain on matching tracks', () => {
  const d = makeFixture(120);
  d.engine.noteOn('C4');
  d.engine.routeCC(null, 64, 127); // CC64 on
  d.engine.noteOff('C4');
  const v = d.track.voice;
  const held = v.voices.find(x => x.activeNote === 'C4' && x._sustainHeld);
  return !!held;
});
check('engine.routePitchBend routes to matching tracks', () => {
  const d = makeFixture(120);
  d.engine.noteOn('C4');
  const v = d.track.voice;
  const before = v.voices.find(x => x.activeNote === 'C4')?.osc?.frequency?.value;
  d.engine.routePitchBend(null, 0.5);
  const after = v.voices.find(x => x.activeNote === 'C4')?.osc?.frequency?.value;
  return after > before;
});

// --- audio clips (M4) ------------------------------------------------------
check('setClipAudio attaches, normalizes and clears audio refs', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  const clip = d.engine.addClip('trk_a', { start: 1920, length: 1920 });
  if (!d.engine.setClipAudio('trk_a', clip.id, { hash: 'h1', offset: 1, gain: 0.5 })) return false;
  const got = d.engine.byId.trk_a.clips.find(c => c.id === clip.id).audio;
  if (!got || got.hash !== 'h1' || got.offset !== 1 || got.gain !== 0.5 || got.fadeIn !== 0 || got.fadeOut !== 0) return false;
  if (!d.engine.setClipAudio('trk_a', clip.id, null)) return false;
  return d.engine.byId.trk_a.clips.find(c => c.id === clip.id).audio === null
    && d.engine.setClipAudio('trk_a', 'missing', { hash: 'h' }) === false;
});
check('getTracks preserves clip audio refs', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  const clip = d.engine.addClip('trk_a', { start: 1920, length: 1920 });
  d.engine.setClipAudio('trk_a', clip.id, { hash: 'h9', gain: 0.7 });
  const found = d.engine.getTracks()[0].clips.find(c => c.id === clip.id);
  return !!found && !!found.audio && found.audio.hash === 'h9' && found.audio.gain === 0.7;
});
check('scheduler plays audio clips once with clip bounds', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  const clip = d.engine.addClip('trk_a', { start: 1920, length: 960, events: [] });
  d.engine.setClipAudio('trk_a', clip.id, { hash: 'h1', offset: 0.5, gain: 0.7, fadeIn: 0.1, fadeOut: 0.2 });
  d.play();
  for (let i = 0; i < 25; i++) d.advanceAndTick(100); // 2.5s: clip at 2.0s fires
  const calls = d.audioCalls.filter(c => c.hash === 'h1');
  if (calls.length !== 1) return false;
  const a = calls[0];
  for (let i = 0; i < 20; i++) d.advanceAndTick(100); // to 4.5s: no replay
  return d.audioCalls.filter(c => c.hash === 'h1').length === 1
    && Math.abs(a.when - (d.engine._playStartCtx + 2)) < 1e-9
    && a.offset === 0.5 && a.duration === 1 && a.gain === 0.7
    && a.fadeIn === 0.1 && a.fadeOut === 0.2
    && a.destination === d.track.voice.insertIn;
});
check('scheduler skips audio on disabled tracks', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  const clip = d.engine.addClip('trk_a', { start: 1920, length: 960, events: [] });
  d.engine.setClipAudio('trk_a', clip.id, { hash: 'h1' });
  d.engine.updateTrack('trk_a', { enabled: false });
  d.play();
  for (let i = 0; i < 25; i++) d.advanceAndTick(100);
  return d.audioCalls.filter(c => c.hash === 'h1').length === 0;
});
check('finished audio clips do not replay after seek', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  const clip = d.engine.addClip('trk_a', { start: 1920, length: 960, events: [] });
  d.engine.setClipAudio('trk_a', clip.id, { hash: 'h1' });
  d.play();
  for (let i = 0; i < 40; i++) d.advanceAndTick(100); // 4.0s: clip (2-3s) done
  if (d.audioCalls.filter(c => c.hash === 'h1').length !== 1) return false;
  // Adapter seek sequence past the clip: reset flags, chase (claims the
  // started clip and attempts the remainder — a real engine trims it to
  // nothing), then ticks must not reschedule from the top.
  d.set(4000);
  d.engine._startMs = 4000 - 10000;
  d.engine.tracks.forEach(t => (t.clips || []).forEach(c => delete c._scheduledAudio));
  d.engine.chaseToTick(9600);
  const afterChase = d.audioCalls.filter(c => c.hash === 'h1').length;
  for (let i = 0; i < 10; i++) d.advanceAndTick(100);
  return afterChase === 2 && d.audioCalls.filter(c => c.hash === 'h1').length === 2;
});
check('stop() silences clip audio voices', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  const clip = d.engine.addClip('trk_a', { start: 1920, length: 960, events: [] });
  d.engine.setClipAudio('trk_a', clip.id, { hash: 'h1' });
  d.play();
  d.engine.stop();
  return d.audioCalls.some(c => c.stopAll === true);
});
check('chase restarts audible audio with the clip region and flags it', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  const clip = d.engine.addClip('trk_a', { start: 1920, length: 1920, events: [] });
  d.engine.setClipAudio('trk_a', clip.id, { hash: 'h1', offset: 0.25 });
  d.play();
  for (let i = 0; i < 10; i++) d.advanceAndTick(100); // 1.0s, before the clip
  if (d.audioCalls.filter(c => c.hash === 'h1').length !== 0) return false;
  d.engine.chaseToTick(2880); // 3.0s, inside the 2-4s clip region
  const calls = d.audioCalls.filter(c => c.hash === 'h1');
  if (calls.length !== 1) return false;
  for (let i = 0; i < 10; i++) d.advanceAndTick(100);
  return d.audioCalls.filter(c => c.hash === 'h1').length === 1
    && Math.abs(calls[0].duration - 2) < 1e-9 && calls[0].offset === 0.25
    && clip._scheduledAudio === true;
});
check('seek past a finished MIDI clip does not replay it', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  d.engine.addClip('trk_a', { start: 1920, length: 1920, events: [
    { note: 'A3', start: 0, dur: 480, velocity: 100 },
  ]});
  d.play();
  for (let i = 0; i < 30; i++) d.advanceAndTick(100); // 3.0s: note (2.0-2.5s) done
  const before = d.spy.filter(s => s.note === 'A3' && s.type === 'on').length;
  if (before !== 1) return false;
  // Simulate the adapter seek sequence to 10s: rebase clock, reset flags,
  // retire finished events, then tick — the finished note must not replay.
  d.set(3000);
  d.engine._startMs = 3000 - 10000;
  d.engine.tracks.forEach(t => (t.clips || []).forEach(c => (c.events || []).forEach(ev => delete ev._scheduledLin)));
  d.engine._markPastLinear(9600);
  for (let i = 0; i < 5; i++) d.advanceAndTick(100);
  return d.spy.filter(s => s.note === 'A3' && s.type === 'on').length === 1;
});
check('setClipAudioCommand applies and undoes', () => {
  const d = makeFixture(120);
  d.engine.addClip('trk_a', { start: 0, length: 1920 });
  const clip = d.engine.addClip('trk_a', { start: 1920, length: 1920 });
  const cmd = setClipAudioCommand(d.engine, 'trk_a', clip.id, { hash: 'hx' });
  cmd.apply();
  if (d.engine.byId.trk_a.clips.find(c => c.id === clip.id).audio.hash !== 'hx') return false;
  cmd.undo();
  return d.engine.byId.trk_a.clips.find(c => c.id === clip.id).audio === null;
});

summary.textContent = `SUMMARY: ${passed.length} passed, ${failed.length} failed`;
if (failed.length > 0) {
  summary.style.color = '#ff4444';
  summary.textContent += ` — ${failed.join(', ')}`;
}