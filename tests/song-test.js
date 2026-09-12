import { createMockAudioContext } from './mockAudioContext.js';
import { createTrackEngine } from '../src/tracks/trackEngine.js';
import { createHistory } from '../src/project/history.js';
import { toggleGridStepCommand, setGridStepCommand, clearTrackCommand } from '../src/project/trackCommands.js';
import { defaultProject } from '../src/project/defaultProject.js';
import { parseProject, serializeProject } from '../src/project/serialize.js';

let passed = 0, failed = 0;
function check(name, fn) {
  const el = document.createElement('li');
  try { if (fn() === false) throw new Error('assertion returned false'); passed++; el.textContent = 'PASS ' + name; }
  catch (e) { failed++; el.textContent = 'FAIL ' + name + ': ' + e.message; }
  document.getElementById('results').append(el);
}
function setup(mode = 'song') {
  const ctx = createMockAudioContext();
  const engine = createTrackEngine(ctx, ctx.destination, { playbackMode: mode });
  let ms = 0;
  engine._setClock(() => ms);
  const t = engine.addTrack({ id: 'a' });
  const hits = [];
  t.voice.noteOn = (note, when, dur) => hits.push({ note, when, dur });
  const play = () => { engine.play(); engine.stopTimer(); };
  const at = time => { ms = time; ctx.currentTime = ms / 1000; engine._tick(); };
  return { engine, t, hits, play, at };
}
const notes = () => [
  { note: 'C4', start: 17, dur: 87, velocity: 51 },
  { note: 'E4', start: 17, dur: 145, velocity: 91 },
  { note: 'G4', start: 365, dur: 71, velocity: 73 },
];
check('unrelated step edit preserves chord, timing, duration and velocity', () => {
  const { engine } = setup(); const c = engine.addClip('a', { events: notes() });
  engine.toggleGridStep('a', 8, 'A4');
  const ok = JSON.stringify(c.events.slice(0, 3)) === JSON.stringify(notes()); engine.dispose(); return ok;
});
check('pitch edit changes only the represented note in a chord', () => {
  const { engine } = setup(); const c = engine.addClip('a', { events: notes() });
  engine.setGridStep('a', 0, { note: 'F4' });
  const expected = notes(); expected[1].note = 'F4';
  const ok = JSON.stringify(c.events) === JSON.stringify(expected); engine.dispose(); return ok;
});
check('toggle removes one represented chord note, not the chord', () => {
  const { engine } = setup(); const c = engine.addClip('a', { events: notes() });
  engine.toggleGridStep('a', 0);
  const ok = c.events.length === 2 && c.events[0].note === 'C4' && c.events[0].start === 17;
  engine.dispose(); return ok;
});
check('step undo/redo restores complete events rather than quantized projection', () => {
  const { engine } = setup(); const c = engine.addClip('a', { events: notes() }); const h = createHistory();
  h.execute(setGridStepCommand(engine, 'a', 0, { dur: 4 })); h.undo();
  const ok = JSON.stringify(engine.byId.a.clips[0].events) === JSON.stringify(notes());
  h.redo(); const edited = engine.byId.a.clips[0].events[1].dur === 480;
  h.execute(toggleGridStepCommand(engine, 'a', 0)); h.undo();
  const restored = engine.byId.a.clips[0].events.length === 3;
  engine.dispose(); return ok && edited && restored;
});
check('step edits on offset clips land in source ticks', () => {
  const { engine } = setup();
  const c = engine.addClip('a', { start: 1920, length: 1920, offset: 960, events: [] });
  engine.selectStepClip('a', c.id);
  engine.toggleGridStep('a', 2, 'D4');
  const evs = engine.byId.a.clips.find(x => x.id === c.id).events;
  const grid = engine.getStepGrid('a');
  const okNew = evs.length === 1 && evs[0].note === 'D4' && evs[0].start === 960 + 240;
  engine.toggleGridStep('a', 2);
  const okDel = engine.byId.a.clips.find(x => x.id === c.id).events.length === 0;
  engine.dispose(); return okNew && okDel && grid[2] && grid[2].note === 'D4';
});
check('getTracks does not rewrite events', () => {
  const { engine } = setup(); const c = engine.addClip('a', { events: notes() });
  engine.getTracks(); engine.getTracks();
  const ok = JSON.stringify(c.events) === JSON.stringify(notes()); engine.dispose(); return ok;
});
check('SONG clip at zero plays once over several bars', () => {
  const { engine, hits, play, at } = setup(); engine.addClip('a', { events: [{ note: 'C4', start: 0, dur: 120 }] });
  play(); at(2000); at(4000); const ok = hits.length === 1; engine.dispose(); return ok;
});
check('PATTERN retains first-bar repetition', () => {
  const { engine, hits, play, at } = setup('pattern'); engine.addClip('a', { events: [{ note: 'C4', start: 0, dur: 120 }] });
  play(); at(2000); at(4000); const ok = hits.length === 3; engine.dispose(); return ok;
});
check('two SONG clips at zero both play once', () => {
  const { engine, hits, play, at } = setup();
  engine.addClip('a', { events: [{ note: 'C4', start: 0, dur: 120 }] });
  engine.addClip('a', { events: [{ note: 'E4', start: 0, dur: 120 }] });
  play(); at(2000); const ok = hits.map(h => h.note).join(',') === 'C4,E4'; engine.dispose(); return ok;
});
check('moving the first SONG clip leaves silence at zero', () => {
  const { engine, hits, play, at } = setup(); const c = engine.addClip('a', { events: [{ note: 'C4', start: 0, dur: 120 }] });
  engine.moveClip('a', c.id, { start: 1920 }); play(); const silent = hits.length === 0;
  at(1900); const later = hits.length === 1 && Math.abs(hits[0].when - 2.03) < 1e-9;
  engine.dispose(); return silent && later;
});
check('deleting the first clip does not leave a sounding grid', () => {
  const { engine, hits, play, at } = setup(); engine.toggleGridStep('a', 0, 'C4');
  engine.removeClip('a', engine.byId.a.clips[0].id); play(); at(2000);
  const ok = hits.length === 0; engine.dispose(); return ok;
});
check('SONG respects clip end and skips notes outside it', () => {
  const { engine, hits, play } = setup(); engine.addClip('a', { length: 120, events: [{ note: 'C4', start: 0, dur: 960 }, { note: 'E4', start: 120, dur: 120 }] });
  play(); const ok = hits.length === 1 && hits[0].dur === 0.125; engine.dispose(); return ok;
});
check('song snapshot/reload preserves chord data and mode', () => {
  const { engine } = setup(); engine.addClip('a', { events: notes() });
  const project = serializeProject({ tracks: engine.getTracks(), tempo: 120, playbackMode: engine.playbackMode });
  const parsed = parseProject(JSON.stringify(project));
  const restored = setup(parsed.playbackMode).engine;
  restored.removeTrack('a'); restored.addTrack(parsed.tracks[0]);
  const ok = parsed.playbackMode === 'song' && JSON.stringify(restored.getTracks()[0].clips[0].events) === JSON.stringify(notes());
  engine.dispose(); restored.dispose(); return ok;
});
check('unversioned playback setting retains legacy PATTERN semantics', () => {
  const old = defaultProject(); delete old.playbackMode;
  return parseProject(JSON.stringify(old)).playbackMode === 'pattern';
});
check('first song step is a real clip and undo removes it', () => {
  const { engine } = setup(); const h = createHistory(); h.execute(toggleGridStepCommand(engine, 'a', 2));
  const created = engine.getTracks()[0].clips.length === 1; h.undo();
  const removed = engine.getTracks()[0].clips.length === 0; h.redo();
  const restored = engine.getTracks()[0].clips[0].events[0].start === 240;
  engine.dispose(); return created && removed && restored;
});
check('selected nonzero clip is edited without changing zero clip or playback grid', () => {
  const { engine, t } = setup();
  const a = engine.addClip('a', { events: notes() });
  const b = engine.addClip('a', { start: 1920, events: notes() });
  const grid = JSON.stringify(t.grid);
  engine.selectStepClip('a', b.id);
  engine.setGridStep('a', 0, { note: 'F4' });
  const ok = a.events[1].note === 'E4' && b.events[1].note === 'F4'
    && JSON.stringify(t.grid) === grid && engine.getStepGrid('a')[0].note === 'F4';
  engine.dispose(); return ok;
});
check('selection follows clip ID after moving and rejects unknown IDs', () => {
  const { engine } = setup(); const c = engine.addClip('a', { events: notes() });
  engine.selectStepClip('a', c.id); engine.moveClip('a', c.id, { start: 3840 });
  const rejected = engine.selectStepClip('a', 'missing') === false;
  engine.toggleGridStep('a', 8, 'A4');
  const ok = rejected && engine.getTracks()[0].clips.length === 1 && c.events.length === 4;
  engine.dispose(); return ok;
});
for (const [name, command] of [
  ['pitch', e => setGridStepCommand(e, 'a', 0, { note: 'F4' })],
  ['toggle', e => toggleGridStepCommand(e, 'a', 0)],
  ['clear', e => clearTrackCommand(e, 'a')],
]) check(name + ' redo keeps its original target after editor selection changes', () => {
  const { engine } = setup(); const h = createHistory();
  const a = engine.addClip('a', { events: notes() });
  const b = engine.addClip('a', { start: 1920, events: notes() });
  engine.selectStepClip('a', b.id); h.execute(command(engine));
  const after = JSON.stringify(engine.getTracks()[0].clips);
  h.undo(); engine.selectStepClip('a', a.id); h.redo();
  const ok = JSON.stringify(engine.getTracks()[0].clips) === after;
  h.undo(); const restored = engine.getTracks()[0].clips.every(c => JSON.stringify(c.events) === JSON.stringify(notes()));
  engine.dispose(); return ok && restored;
});
check('restored clip events and audio are detached from caller snapshots', () => {
  const { engine } = setup(); const clips = [{ id: 'source', start: 1920, events: notes(), audio: { hash: 'asset', gain: 0.5 } }];
  engine.updateTrack('a', { clips });
  engine.byId.a.clips[0].events[0].note = 'B4'; engine.byId.a.clips[0].audio.gain = 0.1;
  const ok = clips[0].events[0].note === 'C4' && clips[0].audio.gain === 0.5;
  engine.dispose(); return ok;
});
document.getElementById('summary').textContent = `${passed} passed, ${failed} failed`;
