import { createMockAudioContext } from './mockAudioContext.js';
import { createTrackEngine } from '../src/tracks/trackEngine.js';
import { createHistory } from '../src/project/history.js';
import {
  addTrackCommand, removeTrackCommand, updateTrackCommand,
  clearTrackCommand, toggleGridStepCommand, setGridStepCommand,
  setTrackFlagCommand, renameTrackCommand, reorderTrackCommand, resizeTrackCommand,
} from '../src/project/trackCommands.js';

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

function makeEngine() {
  const ctx = createMockAudioContext();
  return createTrackEngine(ctx, ctx.destination, { bpm: 120 });
}

// ---- history core --------------------------------------------------------
check('history starts empty: no undo/redo, not dirty', () => {
  const h = createHistory();
  const s = h.state();
  return !s.canUndo && !s.canRedo && s.dirty === false;
});

check('execute stores a command and marks dirty', () => {
  const h = createHistory();
  const ran = [];
  h.execute({ label: 'x', apply: () => ran.push('a'), undo: () => ran.push('u') });
  const s = h.state();
  return ran.length === 1 && ran[0] === 'a' && s.canUndo && s.dirty === true;
});

check('undo/redo run in LIFO order', () => {
  const h = createHistory();
  const log = [];
  h.execute({ label: '1', apply: () => log.push('a1'), undo: () => log.push('u1') });
  h.execute({ label: '2', apply: () => log.push('a2'), undo: () => log.push('u2') });
  h.undo(); h.undo();
  // redo re-applies the last-undone command (LIFO), i.e. command 1
  h.redo();
  return log.join(',') === 'a1,a2,u2,u1,a1';
});

check('execute after undo clears the redo stack', () => {
  const h = createHistory();
  const log = [];
  h.execute({ label: '1', apply: () => log.push('a1'), undo: () => log.push('u1') });
  h.execute({ label: '2', apply: () => log.push('a2'), undo: () => log.push('u2') });
  h.undo();
  h.execute({ label: '3', apply: () => log.push('a3'), undo: () => log.push('u3') });
  return h.state().canRedo === false && log.join(',') === 'a1,a2,u2,a3';
});

check('markSaved resets dirty; new command dirties again', () => {
  const h = createHistory();
  h.execute({ label: 'x', apply: () => {}, undo: () => {} });
  h.markSaved();
  if (h.state().dirty !== false) return false;
  h.execute({ label: 'y', apply: () => {}, undo: () => {} });
  return h.state().dirty === true;
});

check('undo past empty returns false and keeps state', () => {
  const h = createHistory();
  const log = [];
  h.execute({ label: '1', apply: () => log.push('a'), undo: () => log.push('u') });
  h.undo();
  return h.undo() === false && h.redo() === true;
});

check('reset clears both stacks', () => {
  const h = createHistory();
  h.execute({ label: 'x', apply: () => {}, undo: () => {} });
  h.reset();
  return !h.state().canUndo && !h.state().canRedo && h.state().dirty === false;
});

check('onChange fires on execute/undo/redo/markSaved/reset', () => {
  const h = createHistory();
  let count = 0;
  h.onChange(() => count++);
  h.execute({ label: 'x', apply: () => {}, undo: () => {} });
  h.undo();
  h.redo();
  h.markSaved();
  h.reset();
  return count >= 4;
});

check('subscribe receives state on every notify', () => {
  const h = createHistory();
  const seen = [];
  h.subscribe((s) => seen.push(s));
  h.execute({ label: 'x', apply: () => {}, undo: () => {} });
  h.undo();
  h.redo();
  const last = seen[seen.length - 1];
  return seen.length === 3 && last.canUndo === true && last.canRedo === false;
});

check('subscribe coexists with onChange', () => {
  const h = createHistory();
  const primary = [];
  const extra = [];
  h.onChange((s) => primary.push(s));
  h.subscribe((s) => extra.push(s));
  h.execute({ label: 'x', apply: () => {}, undo: () => {} });
  return primary.length === 1 && extra.length === 1 && primary[0].dirty === true;
});

// ---- track commands ------------------------------------------------------
check('addTrackCommand adds then undo removes it', () => {
  const e = makeEngine();
  const h = createHistory();
  h.execute(addTrackCommand(e, { name: 'T' }));
  if (e.tracks.length !== 1) return false;
  const id = e.tracks[0].id;
  h.undo();
  return e.tracks.length === 0 && !e.byId[id];
});

check('addTrackCommand redo re-creates the same id', () => {
  const e = makeEngine();
  const h = createHistory();
  const cmd = addTrackCommand(e, { name: 'T' });
  h.execute(cmd);
  const id = cmd.createdId;
  h.undo();
  h.redo();
  return e.tracks.length === 1 && e.tracks[0].id === id;
});

check('removeTrackCommand undo restores track config', () => {
  const e = makeEngine();
  const t = e.addTrack({ name: 'T', wave: 'sawtooth', filterType: 'lowpass', gridNote: 'E3' });
  const h = createHistory();
  h.execute(removeTrackCommand(e, t.id));
  if (e.tracks.length !== 0) return false;
  h.undo();
  const back = e.byId[t.id];
  return !!back && back.wave === 'sawtooth' && back.filterType === 'lowpass' && back.gridNote === 'E3';
});

check('removeTrackCommand undo restores grid and rt', () => {
  const e = makeEngine();
  const t = e.addTrack({ name: 'T' });
  e.toggleGridStep(t.id, 2, 'C4', 3);
  const h = createHistory();
  h.execute(removeTrackCommand(e, t.id));
  h.undo();
  const cell = e.byId[t.id].grid[2];
  return cell && cell.note === 'C4' && cell.dur === 3;
});

check('updateTrackCommand undo restores wave/filter', () => {
  const e = makeEngine();
  const t = e.addTrack({ name: 'T', wave: 'square' });
  const h = createHistory();
  h.execute(updateTrackCommand(e, t.id, { wave: 'sawtooth', filterType: 'lowpass' }));
  if (e.byId[t.id].wave !== 'sawtooth') return false;
  h.undo();
  const back = e.byId[t.id];
  return back.wave === 'square' && back.filterType === 'none';
});

check('updateTrackCommand redo reapplies the patch', () => {
  const e = makeEngine();
  const t = e.addTrack({ name: 'T' });
  const h = createHistory();
  h.execute(updateTrackCommand(e, t.id, { gridDur: 4 }));
  h.undo();
  h.redo();
  return e.byId[t.id].gridDur === 4;
});

check('clearTrackCommand undo restores grid and rt', () => {
  const e = makeEngine();
  const t = e.addTrack({ name: 'T' });
  e.toggleGridStep(t.id, 0, 'C4');
  t.rt = [{ note: 'E4', start: 0.5, dur: 0.25 }];
  const h = createHistory();
  h.execute(clearTrackCommand(e, t.id));
  if (e.byId[t.id].grid.every(s => s === null) === false) return false;
  h.undo();
  const back = e.byId[t.id];
  return back.grid[0] && back.grid[0].note === 'C4' && back.rt.length === 1 && back.rt[0].note === 'E4';
});

check('toggleGridStepCommand undo restores the exact cell', () => {
  const e = makeEngine();
  const t = e.addTrack({ name: 'T' });
  const h = createHistory();
  const cmd = toggleGridStepCommand(e, t.id, 5);
  h.execute(cmd);
  // cmd.on is the cell object when toggled on (truthy), false when off
  if (!cmd.on || !e.byId[t.id].grid[5]) return false;
  h.undo();
  return e.byId[t.id].grid[5] === null;
});

check('setGridStepCommand undo restores previous pitch/dur', () => {
  const e = makeEngine();
  const t = e.addTrack({ name: 'T' });
  e.toggleGridStep(t.id, 3, 'C4', 1);
  const h = createHistory();
  h.execute(setGridStepCommand(e, t.id, 3, { note: 'A3', dur: 2 }));
  const cell = e.byId[t.id].grid[3];
  if (!(cell.note === 'A3' && cell.dur === 2)) return false;
  h.undo();
  const back = e.byId[t.id].grid[3];
  return back.note === 'C4' && back.dur === 1;
});

check('commands compose: add->toggle->undo->undo->redo->redo', () => {
  const e = makeEngine();
  const h = createHistory();
  const add = addTrackCommand(e, { name: 'T' });
  h.execute(add);
  const t = e.byId[add.createdId];
  h.execute(toggleGridStepCommand(e, t.id, 0));
  h.undo(); // toggle off
  h.undo(); // remove track
  if (e.tracks.length !== 0) return false;
  h.redo(); // re-add
  h.redo(); // re-toggle
  const back = e.byId[add.createdId];
  return e.tracks.length === 1 && back.grid[0] && back.grid[0].note === 'C4';
});

check('setTrackFlagCommand toggles muted and undo restores it', () => {
  const e = makeEngine();
  const t = e.addTrack({ name: 'T' });
  const h = createHistory();
  h.execute(setTrackFlagCommand(e, t.id, 'muted', true));
  if (e.byId[t.id].muted !== true) return false;
  h.undo();
  return e.byId[t.id].muted === false;
});

check('setTrackFlagCommand redo reapplies the muted flag', () => {
  const e = makeEngine();
  const t = e.addTrack({ name: 'T' });
  const h = createHistory();
  h.execute(setTrackFlagCommand(e, t.id, 'muted', true));
  h.undo();
  h.redo();
  return e.byId[t.id].muted === true;
});

check('setTrackFlagCommand handles solo the same way', () => {
  const e = makeEngine();
  const t = e.addTrack({ name: 'T' });
  const h = createHistory();
  h.execute(setTrackFlagCommand(e, t.id, 'solo', true));
  if (e.byId[t.id].solo !== true) return false;
  h.undo();
  if (e.byId[t.id].solo !== false) return false;
  h.redo();
  return e.byId[t.id].solo === true;
});

check('renameTrackCommand renames and undo restores the old name', () => {
  const e = makeEngine();
  const t = e.addTrack({ name: 'Bass' });
  const h = createHistory();
  h.execute(renameTrackCommand(e, t.id, 'Lead'));
  if (e.byId[t.id].name !== 'Lead') return false;
  h.undo();
  if (e.byId[t.id].name !== 'Bass') return false;
  h.redo();
  return e.byId[t.id].name === 'Lead';
});

check('renameTrackCommand with an empty name returns null (no command)', () => {
  const e = makeEngine();
  const t = e.addTrack({ name: 'Bass' });
  const cmd = renameTrackCommand(e, t.id, '   ');
  return cmd === null && e.byId[t.id].name === 'Bass';
});

check('reorderTrackCommand moves a track and undo restores the position', () => {
  const e = makeEngine();
  const a = e.addTrack({ name: 'A' });
  e.addTrack({ name: 'B' });
  e.addTrack({ name: 'C' });
  const h = createHistory();
  h.execute(reorderTrackCommand(e, a.id, 2));
  if (e.tracks.map(t => t.id).join(',') !== 'trk_2,trk_3,trk_1') return false;
  h.undo();
  return e.tracks.map(t => t.id).join(',') === 'trk_1,trk_2,trk_3';
});

check('reorderTrackCommand redo reapplies the target position', () => {
  const e = makeEngine();
  e.addTrack({ name: 'A' });
  const b = e.addTrack({ name: 'B' });
  e.addTrack({ name: 'C' });
  const h = createHistory();
  h.execute(reorderTrackCommand(e, b.id, 0));
  h.undo();
  if (e.tracks.map(t => t.id).join(',') !== 'trk_1,trk_2,trk_3') return false;
  h.redo();
  return e.tracks.map(t => t.id).join(',') === 'trk_2,trk_1,trk_3';
});

check('resizeTrackCommand sets height and undo restores it', () => {
  const e = makeEngine();
  const a = e.addTrack({ name: 'A' });
  const h = createHistory();
  if (e.byId[a.id].height !== null) return false;
  h.execute(resizeTrackCommand(e, a.id, 66));
  if (e.byId[a.id].height !== 66) return false;
  h.undo();
  return e.byId[a.id].height === null;
});

summary.textContent = `SUMMARY: ${passed.length} passed, ${failed.length} failed`;
if (failed.length > 0) {
  summary.style.color = '#ff4444';
  summary.textContent += ` — ${failed.join(', ')}`;
}