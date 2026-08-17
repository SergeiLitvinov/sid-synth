import { createMockAudioContext } from './mockAudioContext.js';
import {
  createTrackEngine,
  defaultTrackConfig,
  STEPS_PER_LOOP,
} from '../src/tracks/trackEngine.js';

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
  const engine = createTrackEngine(ctx, ctx.destination, { bpm });
  engine._setClock(() => now);
  const track = engine.addTrack({ name: 'T1', id: 'trk_a' });
  engine.activeTrackId = 'trk_a';
  const spy = [];
  const orig = track.voice.noteOn.bind(track.voice);
  track.voice.noteOn = (note, at, dur) => { spy.push({ note, at, dur }); orig(note, at, dur); };
  const driver = {
    engine, track, ctx, spy,
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

summary.textContent = `SUMMARY: ${passed.length} passed, ${failed.length} failed`;
if (failed.length > 0) {
  summary.style.color = '#ff4444';
  summary.textContent += ` — ${failed.join(', ')}`;
}