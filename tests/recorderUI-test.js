import { createMockAudioContext } from './mockAudioContext.js';
import { createTrackEngine } from '../src/tracks/trackEngine.js';
import { createRecorderUI } from '../src/tracks/recorderUI.js';
import { createHistory } from '../src/project/history.js';

const container = document.getElementById('container');
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

function make() {
  const ctx = createMockAudioContext();
  const engine = createTrackEngine(ctx, ctx.destination, { bpm: 120 });
  const history = createHistory();
  const ui = createRecorderUI({ container, engine, history });
  return { engine, history, ui };
}

const { engine, history, ui } = make();
const $ = (id) => document.getElementById(id);

check('panel renders ADD/undo/redo buttons', () => {
  return !!$('recAdd') && !!$('recUndo') && !!$('recRedo');
});

check('undo/redo start disabled', () => {
  return $('recUndo').disabled === true && $('recRedo').disabled === true;
});

check('ADD runs as a command and selects the new track', () => {
  const before = engine.tracks.length;
  $('recAdd').click();
  return engine.tracks.length === before + 1
    && engine.activeTrackId === engine.tracks[engine.tracks.length - 1].id
    && history.state().canUndo === true;
});

check('undo removes the added track and re-enables redo', () => {
  const count = engine.tracks.length;
  history.undo();
  return engine.tracks.length === count - 1
    && history.state().canRedo === true
    && $('recRedo').disabled === false
    && $('recUndo').disabled === true; // nothing left to undo
});

check('redo re-adds the track with the same id', () => {
  const before = engine.tracks.map(t => t.id);
  history.redo();
  const after = engine.tracks.map(t => t.id);
  return after.length === before.length + 1
    && after.slice(0, before.length).join(',') === before.join(',');
});

check('grid toggle is undoable', () => {
  const id = engine.tracks[engine.tracks.length - 1].id;
  const row = [...container.querySelectorAll('.rec-row:not(.rec-head)')].pop();
  const cell = row.querySelector('.rec-cell');
  cell.click();
  if (!engine.byId[id].grid[0]) return false;
  history.undo();
  return engine.byId[id].grid[0] === null && history.state().canRedo === true;
});

check('DEL button runs removeTrack as a command', () => {
  const id = engine.tracks[engine.tracks.length - 1].id;
  const rows = [...container.querySelectorAll('.rec-track')];
  const row = rows.find(r => r.dataset.id === id);
  const delBtn = [...row.querySelectorAll('.rec-btn')].find(b => b.textContent === 'DEL');
  delBtn.click();
  if (engine.byId[id]) return false;
  history.undo();
  return !!engine.byId[id];
});

check('wave select runs updateTrack as a command', () => {
  const id = engine.tracks[engine.tracks.length - 1].id;
  const rows = [...container.querySelectorAll('.rec-track')];
  const row = rows.find(r => r.dataset.id === id);
  const sel = row.querySelector('select:not(.rec-midi-ch)');
  sel.value = 'sawtooth';
  sel.dispatchEvent(new Event('change'));
  if (engine.byId[id].wave !== 'sawtooth') return false;
  history.undo();
  return engine.byId[id].wave === 'square';
});

check('track rows render M and S flag buttons', () => {
  const row = [...container.querySelectorAll('.rec-track')].pop();
  const texts = [...row.querySelectorAll('.rec-btn')].map(b => b.textContent);
  return texts.includes('M') && texts.includes('S');
});

check('M button mutes the track as an undoable command', () => {
  const row = [...container.querySelectorAll('.rec-track')].pop();
  const id = row.dataset.id;
  const m = [...row.querySelectorAll('.rec-btn')].find(b => b.textContent === 'M');
  m.click();
  const rowAfter = [...container.querySelectorAll('.rec-track')].pop();
  const mAfter = [...rowAfter.querySelectorAll('.rec-btn')].find(b => b.textContent === 'M');
  if (!engine.byId[id].muted || !mAfter.classList.contains('on')) return false;
  history.undo();
  const rowUndone = [...container.querySelectorAll('.rec-track')].pop();
  const mUndone = [...rowUndone.querySelectorAll('.rec-btn')].find(b => b.textContent === 'M');
  return engine.byId[id].muted === false && mUndone.classList.contains('on') === false;
});

check('S button solos the track as an undoable command', () => {
  const row = [...container.querySelectorAll('.rec-track')].pop();
  const id = row.dataset.id;
  const s = [...row.querySelectorAll('.rec-btn')].find(b => b.textContent === 'S');
  s.click();
  const rowAfter = [...container.querySelectorAll('.rec-track')].pop();
  const sAfter = [...rowAfter.querySelectorAll('.rec-btn')].find(b => b.textContent === 'S');
  if (!engine.byId[id].solo || !sAfter.classList.contains('on')) return false;
  history.undo();
  const rowUndone = [...container.querySelectorAll('.rec-track')].pop();
  const sUndone = [...rowUndone.querySelectorAll('.rec-btn')].find(b => b.textContent === 'S');
  return engine.byId[id].solo === false && sUndone.classList.contains('on') === false;
});

check('double-clicking the track name renames it as an undoable command', () => {
  const row = [...container.querySelectorAll('.rec-track')].pop();
  const id = row.dataset.id;
  const oldName = engine.byId[id].name;
  const nameEl = row.querySelector('.rec-track-name');
  nameEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const input = row.querySelector('.rec-track-name-input');
  if (!input) return false;
  input.value = 'Renamed';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  if (engine.byId[id].name !== 'Renamed') return false;
  history.undo();
  return engine.byId[id].name === oldName;
});

check('escaping the rename input cancels the edit', () => {
  const row = [...container.querySelectorAll('.rec-track')].pop();
  const id = row.dataset.id;
  const oldName = engine.byId[id].name;
  const nameEl = row.querySelector('.rec-track-name');
  nameEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const input = row.querySelector('.rec-track-name-input');
  input.value = 'Cancelled';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const rowAfter = [...container.querySelectorAll('.rec-track')].pop();
  return engine.byId[id].name === oldName && !rowAfter.querySelector('.rec-track-name-input');
});

check('an empty rename is ignored', () => {
  const row = [...container.querySelectorAll('.rec-track')].pop();
  const id = row.dataset.id;
  const oldName = engine.byId[id].name;
  const nameEl = row.querySelector('.rec-track-name');
  nameEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const input = row.querySelector('.rec-track-name-input');
  input.value = '   ';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return engine.byId[id].name === oldName;
});

check('▲ reorder button moves the track up as an undoable command', () => {
  if (engine.tracks.length < 2) $('recAdd').click();
  const rows0 = [...container.querySelectorAll('.rec-track')];
  const lastId = rows0[rows0.length - 1].dataset.id;
  const up = [...rows0[rows0.length - 1].querySelectorAll('.rec-btn')].find(b => b.textContent === '▲');
  if (!up || up.classList.contains('dim')) return false;
  up.click();
  const rows1 = [...container.querySelectorAll('.rec-track')];
  if (rows1[rows1.length - 2].dataset.id !== lastId) return false;
  history.undo();
  const rows2 = [...container.querySelectorAll('.rec-track')];
  return rows2[rows2.length - 1].dataset.id === lastId;
});

check('▼ reorder button moves the track down and the first row dims ▲', () => {
  if (engine.tracks.length < 2) $('recAdd').click();
  const rows0 = [...container.querySelectorAll('.rec-track')];
  const firstId = rows0[0].dataset.id;
  const up = [...rows0[0].querySelectorAll('.rec-btn')].find(b => b.textContent === '▲');
  if (!up.classList.contains('dim')) return false;
  const down = [...rows0[0].querySelectorAll('.rec-btn')].find(b => b.textContent === '▼');
  down.click();
  const rows1 = [...container.querySelectorAll('.rec-track')];
  return rows1[1].dataset.id === firstId;
});

check('the color input re-colors the track as an undoable command', () => {
  const row = [...container.querySelectorAll('.rec-track')].pop();
  const id = row.dataset.id;
  const oldColor = engine.byId[id].color;
  const colorIn = row.querySelector('.rec-track-color');
  if (!colorIn) return false;
  colorIn.value = '#ff00ff';
  colorIn.dispatchEvent(new Event('input', { bubbles: true }));
  if (engine.byId[id].color !== '#ff00ff') return false;
  history.undo();
  return engine.byId[id].color === oldColor;
});

check('the color input keeps the row accent in sync', () => {
  const row = [...container.querySelectorAll('.rec-track')].pop();
  const colorIn = row.querySelector('.rec-track-color');
  const accent = row.style.getPropertyValue('--tcolor');
  return !!colorIn && accent === engine.byId[row.dataset.id].color;
});

check('MNT button toggles input monitor as an undoable command', () => {
  const row = [...container.querySelectorAll('.rec-track')].pop();
  const id = row.dataset.id;
  const wasOn = engine.byId[id].monitor;
  const mnt = [...row.querySelectorAll('.rec-btn')].find(b => b.textContent === 'MNT');
  if (!mnt) return false;
  mnt.click();
  const rowAfter = [...container.querySelectorAll('.rec-track')].pop();
  const mntAfter = [...rowAfter.querySelectorAll('.rec-btn')].find(b => b.textContent === 'MNT');
  if (engine.byId[id].monitor !== !wasOn || mntAfter.classList.contains('on') !== !wasOn) return false;
  history.undo();
  return engine.byId[id].monitor === wasOn;
});

check('row renders a collapse toggle button', () => {
  const row = [...container.querySelectorAll('.rec-track')].pop();
  const collapse = [...row.querySelectorAll('.rec-btn')].find(b => b.textContent === '▾' || b.textContent === '▸');
  return !!collapse;
});

check('collapse toggle hides the grid row as an undoable command', () => {
  const row = [...container.querySelectorAll('.rec-track')].pop();
  const id = row.dataset.id;
  const name = engine.byId[id].name;
  const collapse = [...row.querySelectorAll('.rec-btn')].find(b => b.textContent === '▾' || b.textContent === '▸');
  if (!collapse) return false;
  collapse.click();
  const rowAfter = [...container.querySelectorAll('.rec-track')].pop();
  const collapseAfter = [...rowAfter.querySelectorAll('.rec-btn')].find(b => b.textContent === '▾' || b.textContent === '▸');
  const bodyRows = [...container.querySelectorAll('.rec-row')].filter(r => !r.classList.contains('rec-head'));
  const gridHidden = !bodyRows.some(r => r.querySelector('.rec-row-label') && r.querySelector('.rec-row-label').textContent === name);
  if (engine.byId[id].collapsed !== true || !collapseAfter || collapseAfter.textContent !== '▸' || !gridHidden) return false;
  history.undo();
  return engine.byId[id].collapsed === false;
});

check('track rows render an INS insert button', () => {
  const row = [...container.querySelectorAll('.rec-track')].pop();
  const ins = [...row.querySelectorAll('.rec-btn')].find(b => b.textContent === 'INS');
  return !!ins;
});

check('INS click expands the insert editor panel', () => {
  const row = [...container.querySelectorAll('.rec-track')].pop();
  const ins = [...row.querySelectorAll('.rec-btn')].find(b => b.textContent === 'INS');
  ins.click();
  const panels = [...container.querySelectorAll('.rec-inserts')];
  return panels.length === 1;
});

// The INS button toggles the panel; tests below need it open, so only click it
// when the panel is not already rendered (re-renders keep the open state).
function ensureInsPanel() {
  if (!container.querySelector('.rec-inserts')) {
    const row = [...container.querySelectorAll('.rec-track')].pop();
    const ins = [...row.querySelectorAll('.rec-btn')].find(b => b.textContent === 'INS');
    ins.click();
  }
}

check('+ DLY adds a delay insert as an undoable command', () => {
  ensureInsPanel();
  const id = engine.tracks[engine.tracks.length - 1].id;
  const before = engine.byId[id].inserts.length;
  const panel = [...container.querySelectorAll('.rec-inserts')].pop();
  const dly = [...panel.querySelectorAll('.rec-btn')].find(b => b.textContent === '+ DLY');
  dly.click();
  const after = engine.byId[id].inserts.length;
  if (after !== before + 1 || engine.byId[id].inserts[before].type !== 'delay') return false;
  if (!history.state().canUndo) return false;
  history.undo();
  return engine.byId[id].inserts.length === before;
});

check('+ RVB adds a reverb insert with a mix param', () => {
  ensureInsPanel();
  const id = engine.tracks[engine.tracks.length - 1].id;
  const panel = [...container.querySelectorAll('.rec-inserts')].pop();
  const rvb = [...panel.querySelectorAll('.rec-btn')].find(b => b.textContent === '+ RVB');
  rvb.click();
  const last = engine.byId[id].inserts[engine.byId[id].inserts.length - 1];
  const insertsEl = [...container.querySelectorAll('.rec-insert')];
  const rvbEl = insertsEl.find(x => x.querySelector('.rec-insert-name').textContent === 'reverb');
  return last.type === 'reverb' && !!rvbEl && !!rvbEl.querySelector('.rec-insert-param');
});

check('insert param edits run as undoable commands', () => {
  ensureInsPanel();
  const id = engine.tracks[engine.tracks.length - 1].id;
  let idx = engine.byId[id].inserts.findIndex(i => i.type === 'delay');
  if (idx < 0) {
    const panel = [...container.querySelectorAll('.rec-inserts')].pop();
    const dly = [...panel.querySelectorAll('.rec-btn')].find(b => b.textContent === '+ DLY');
    dly.click();
    idx = engine.byId[id].inserts.findIndex(i => i.type === 'delay');
  }
  if (idx < 0) return false;
  const before = engine.byId[id].inserts[idx].params.mix;
  const delayEl = [...container.querySelectorAll('.rec-insert')].find(x => x.querySelector('.rec-insert-name').textContent === 'delay');
  const mixIn = [...delayEl.querySelectorAll('.rec-insert-param')].find(i => i.title === 'mix');
  mixIn.value = '0.75';
  mixIn.dispatchEvent(new Event('change'));
  if (engine.byId[id].inserts[idx].params.mix !== 0.75) return false;
  history.undo();
  return engine.byId[id].inserts[idx].params.mix === before;
});

check('✕ removes an insert as an undoable command', () => {
  ensureInsPanel();
  const id = engine.tracks[engine.tracks.length - 1].id;
  const before = engine.byId[id].inserts.length;
  const insertEl = [...container.querySelectorAll('.rec-insert')].pop();
  const del = insertEl.querySelector('.rec-insert-del');
  del.click();
  if (engine.byId[id].inserts.length !== before - 1) return false;
  history.undo();
  return engine.byId[id].inserts.length === before;
});

summary.textContent = `SUMMARY: ${passed.length} passed, ${failed.length} failed`;
if (failed.length > 0) {
  summary.style.color = '#ff4444';
  summary.textContent += ` — ${failed.join(', ')}`;
}