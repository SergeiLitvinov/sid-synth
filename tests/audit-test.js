import { createMockAudioContext } from './mockAudioContext.js';
import { createTrackEngine } from '../src/tracks/trackEngine.js';
import { createHistory } from '../src/project/history.js';
import { createProjectStore, PROJECT_STORAGE_KEY, LEGACY_TRACKS_KEY } from '../src/project/projectStore.js';
import { defaultProject } from '../src/project/defaultProject.js';
import { createTransport } from '../src/project/transport.js';
import { createStepEngineAdapter } from '../src/tracks/stepEngineAdapter.js';
import { removeTrackCommand } from '../src/project/trackCommands.js';
import { noteForMidi, noteToFreq } from '../src/services/notes.js';
import { createProjectSession } from '../src/project/projectSession.js';
import { createMarkerStore } from '../src/project/markers.js';

let passed = 0, failed = 0;
function check(name, fn) {
  const li = document.createElement('li');
  try {
    if (fn() === false) throw new Error('assertion returned false');
    passed++;
    li.textContent = 'PASS ' + name;
  } catch (error) {
    failed++;
    li.textContent = 'FAIL ' + name + ': ' + error.message;
  }
  document.getElementById('results').append(li);
}
function fixture() {
  const ctx = createMockAudioContext();
  const engine = createTrackEngine(ctx, ctx.destination);
  engine.addTrack({ id: 'a' });
  engine.selectTrack('a');
  return engine;
}
function storage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
}
check('failed migration write preserves legacy data', () => {
  const disk = storage({ [LEGACY_TRACKS_KEY]: JSON.stringify({ tracks: [{ id: 'a' }] }) });
  disk.setItem = () => { throw new Error('QuotaExceededError'); };
  createProjectStore({ storage: disk }).readProject();
  return disk.getItem(LEGACY_TRACKS_KEY) !== null;
});
check('newer project survives autosave after failed restore', () => {
  const raw = JSON.stringify({ schemaVersion: 999, tracks: ['valuable data'] });
  const disk = storage({ [PROJECT_STORAGE_KEY]: raw });
  const store = createProjectStore({ storage: disk, capture: () => defaultProject() });
  store.restore();
  store.saveNow();
  return disk.getItem(PROJECT_STORAGE_KEY) === raw;
});
check('history branch at saved depth is dirty', () => {
  const h = createHistory();
  const command = () => ({ apply() {}, undo() {} });
  h.execute(command()); h.markSaved(); h.undo(); h.execute(command());
  return h.state().dirty;
});
check('MIDI note conversion covers 0 through 127', () =>
  noteForMidi(0) === 'C-1' && noteForMidi(127) === 'G9' && noteToFreq('A5') === 880);
check('channel mismatch does not trigger active track', () => {
  const e = fixture(); e.updateTrack('a', { midiChannel: 2 });
  let count = 0; e.byId.a.voice.noteOn = () => count++;
  e.noteOn('C4', { channel: 1 }); e.dispose();
  return count === 0;
});
check('MIDI record delivers one note per matching armed track and closes it', () => {
  const e = fixture(); e.addTrack({ id: 'b', midiChannel: 2 });
  e.armTrack('a', true); e.armTrack('b', true); e._recording = true;
  let hits = 0; e.byId.a.voice.noteOn = () => hits++;
  e.byId.b.voice.noteOn = () => hits += 100;
  e.noteOn('C4', { channel: 1, velocity: 73 });
  e._loopPos = 0.25; e.noteOff('C4', { channel: 1 });
  const note = e._recBuffer.get('a')[0];
  const ok = hits === 1 && note.dur === 0.25 && note.velocity === 73;
  e.dispose(); return ok;
});
check('note-off follows original track after selection changes', () => {
  const e = fixture(); e.addTrack({ id: 'b' });
  let stopped = 0; e.byId.a.voice.noteOff = () => stopped++;
  e.noteOn('C4'); e.selectTrack('b'); e.noteOff('C4'); e.dispose();
  return stopped === 1;
});
check('armed monitor off still records without sounding', () => {
  const e = fixture(); e.armTrack('a', true); e.updateTrack('a', { monitor: false }); e._recording = true;
  let hits = 0; e.byId.a.voice.noteOn = () => hits++;
  e.noteOn('C4'); const ok = hits === 0 && e._recBuffer.get('a').length === 1;
  e.dispose(); return ok;
});
check('release keeps velocity scale rather than dividing it twice', () => {
  const e = fixture(); e.noteOn('C4', { velocity: 64 });
  const v = e.byId.a.voice.voices.find(v => v.activeNote === 'C4');
  e.ctx.currentTime = 1; e.noteOff('C4');
  const set = v.env.gain._history.find(x => x.t === 'set' && x.at === 1);
  const ok = Math.abs(set.v - e.byId.a.adsr.s * 64 / 127) < 1e-10;
  e.dispose(); return ok;
});
check('adapter preserves REPLACE recording preparation', () => {
  const e = fixture(); const t = createTransport({ ctx: e.ctx });
  createStepEngineAdapter(e, t); e.toggleGridStep('a', 0, 'C4'); e.recordMode = 'replace';
  e.record();
  const loop = e.byId.a.clips.find(c => c.start === 0);
  const ok = !!loop && loop.events.length === 0;
  e.stop(); e.dispose(); return ok;
});
check('snapshot preserves chords and off-grid timing', () => {
  const e = fixture(); const c = e.addClip('a', { start: 0 });
  const notes = [{ note: 'C4', start: 15, dur: 87, velocity: 51 }, { note: 'E4', start: 15, dur: 110, velocity: 97 }];
  e.setClipEvents('a', c.id, notes);
  const result = e.getTracks()[0];
  const ok = JSON.stringify(result.clips[0].events) === JSON.stringify(notes);
  const restored = createTrackEngine(e.ctx, e.ctx.destination);
  restored.addTrack(result);
  const again = JSON.stringify(restored.getTracks()[0].clips[0].events) === JSON.stringify(notes);
  e.dispose(); restored.dispose(); return ok && again;
});
check('loop scheduler plays both notes of an off-grid chord', () => {
  const e = fixture(); const c = e.addClip('a', { start: 0 });
  e.setClipEvents('a', c.id, [{ note: 'C4', start: 15, dur: 87 }, { note: 'E4', start: 15, dur: 110 }]);
  const hits = []; e.byId.a.voice.noteOn = n => hits.push(n);
  e.play(); e.stop(); e.dispose();
  return hits.join(',') === 'C4,E4';
});
check('duplicate audio retains source and does not share note objects', () => {
  const e = fixture(); const c = e.addClip('a', { start: 1920, audio: { hash: 'test', offset: 0.2 }, events: [{ note: 'C4', start: 0, dur: 120 }] });
  const copy = e.duplicateClip('a', c.id); copy.events[0].note = 'D4';
  const ok = copy.audio.hash === 'test' && c.events[0].note === 'C4'; e.dispose(); return ok;
});
check('split audio advances source offset', () => {
  const e = fixture(); const c = e.addClip('a', { start: 1920, audio: { hash: 'test', offset: 0.25 } });
  const right = e.splitClip('a', c.id, 2880);
  const ok = right.audio.hash === 'test' && right.audio.offset === 1.25; e.dispose(); return ok;
});
check('undo track removal restores order and velocity', () => {
  const e = fixture();
  e.toggleGridStep('a', 0, 'C4');
  e.setGridStep('a', 0, { vel: 37 });
  e.addTrack({ id: 'b' });
  const h = createHistory(); h.execute(removeTrackCommand(e, 'a')); h.undo();
  const loop = e.byId.a.clips.find(c => c.start === 0);
  const ok = e.tracks[0].id === 'a' && !!loop && loop.events[0].velocity === 37;
  e.dispose(); return ok;
});
check('loading empty project removes default tracks and restores tempo', () => {
  const e = fixture(); const transport = createTransport({ ctx: e.ctx });
  const session = createProjectSession({ components: {}, router: { connections: [], drawConnections() {} },
    clearRack() {}, createComponent() {}, trackEngine: e, transport, markers: createMarkerStore(),
    history: createHistory(), getAssets: () => [], setAssets() {} });
  session.applyProject(defaultProject({ tracks: [], tempo: 95 }));
  const ok = e.tracks.length === 0 && e.bpm === 95; e.dispose(); return ok;
});
document.getElementById('summary').textContent = `${passed} passed, ${failed} failed`;
