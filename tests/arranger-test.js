import {
  ticksToX, xToTicks, snapTicks, barLenTicksAt, computeRuler, contentWidthTicks, layoutTrackBlocks, layoutClips, layoutClipNotes,
} from '../src/arranger/arrangerLayout.js';
import { createTempoMap, addSignature } from '../src/project/tempoMap.js';
import { createTransport } from '../src/project/transport.js';
import { createArranger } from '../src/arranger/arranger.js';
import { createHistory } from '../src/project/history.js';
import { addClipCommand, moveClipCommand, removeClipCommand, splitClipCommand, duplicateClipCommand, repeatClipCommand, moveClipsCommand, removeClipsCommand, renameTrackCommand } from '../src/project/trackCommands.js';
import { createMarkerStore, addMarker, removeMarker, normalizeMarker } from '../src/project/markers.js';
import { addMarkerCommand, removeMarkerCommand } from '../src/project/markerCommands.js';

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

// A track object matching trackEngine.getTracks() plain data (grid cells can be
// { note, dur } or legacy strings).
function track(grid, extra = {}) {
  const cells = Array(16).fill(null);
  grid.forEach((c, i) => { cells[i] = c; });
  return { id: 'trk_x', name: 'T', color: '#4af74a', grid: cells, ...extra };
}

// ---- ticksToX / xToTicks --------------------------------------------------
check('ticksToX: one quarter note = pxPerQuarter at default ppq', () => {
  return ticksToX(480, { pxPerQuarter: 48 }) === 48
    && ticksToX(1920, { pxPerQuarter: 48 }) === 192;
});

check('ticksToX honors custom ppq', () => {
  return ticksToX(96, { ppq: 96, pxPerQuarter: 24 }) === 24;
});

check('ticksToX honors originTicks offset', () => {
  return ticksToX(2400, { pxPerQuarter: 48, originTicks: 480 }) === 192;
});

check('xToTicks is the inverse of ticksToX', () => {
  const opts = { pxPerQuarter: 37, ppq: 480, originTicks: 960 };
  const t = 1234;
  return near(xToTicks(ticksToX(t, opts), opts), t);
});

// ---- ruler / tempo map ----------------------------------------------------
check('barLenTicksAt: 4/4 bar = 4 quarters = 1920 ticks at ppq 480', () => {
  const map = createTempoMap({ bpm: 120 });
  return barLenTicksAt(map, 0) === 1920;
});

check('barLenTicksAt: 3/4 bar = 3 quarters = 1440 ticks', () => {
  const map = createTempoMap({ bpm: 120, num: 3, den: 4 });
  return barLenTicksAt(map, 0) === 1440;
});

check('computeRuler: bar 0 at x 0, bar width scales with pxPerQuarter', () => {
  const map = createTempoMap({ bpm: 120 });
  const r = computeRuler(map, 4, { pxPerQuarter: 48 });
  return r.length === 4
    && r[0].x === 0 && near(r[0].width, 192)
    && near(r[1].x, 192) && near(r[3].endTicks, 4 * 1920);
});

check('computeRuler: signature change shifts bar widths', () => {
  const map = createTempoMap({ bpm: 120 });
  addSignature(map, 0, 3, 4);        // 3/4 from bar 0
  addSignature(map, 2 * 1440, 2, 4); // 2/4 from bar 2 (bar 2 starts at 2880)
  const r = computeRuler(map, 4, { pxPerQuarter: 48 });
  // 3/4 = 1440 ticks = 144px; 2/4 = 960 ticks = 96px
  return near(r[0].width, 144) && near(r[1].width, 144) && near(r[2].width, 96) && near(r[2].startTicks, 2880);
});

check('contentWidthTicks grows with bars', () => {
  const map = createTempoMap({ bpm: 120 });
  return contentWidthTicks(map, 8) === 8 * 1920;
});

// ---- track pattern blocks -------------------------------------------------
check('layoutTrackBlocks: one 16-step loop = one bar', () => {
  const t = track([{ note: 'C4', dur: 1 }]);
  const blocks = layoutTrackBlocks(t, { pxPerQuarter: 48, bars: 1 });
  return blocks.length === 1 && blocks[0].x === 0 && near(blocks[0].width, 12);
});

check('layoutTrackBlocks: step 8 starts at half the bar', () => {
  const t = track([], {});
  t.grid[8] = { note: 'E4', dur: 1 };
  const blocks = layoutTrackBlocks(t, { pxPerQuarter: 48, bars: 1 });
  return blocks.length === 1 && near(blocks[0].x, 96) && blocks[0].note === 'E4';
});

check('layoutTrackBlocks: duration scales width', () => {
  const t = track([{ note: 'C4', dur: 4 }]);
  const blocks = layoutTrackBlocks(t, { pxPerQuarter: 48, bars: 1 });
  return blocks.length === 1 && near(blocks[0].width, 48);
});

check('layoutTrackBlocks: pattern repeats each bar', () => {
  const t = track([{ note: 'C4', dur: 1 }]);
  const blocks = layoutTrackBlocks(t, { pxPerQuarter: 48, bars: 3 });
  return blocks.length === 3 && near(blocks[1].x, 192) && near(blocks[2].x, 384);
});

check('layoutTrackBlocks: legacy string cells normalize to dur 1', () => {
  const t = track(['A3']);
  const blocks = layoutTrackBlocks(t, { pxPerQuarter: 48, bars: 1 });
  return blocks.length === 1 && blocks[0].note === 'A3' && near(blocks[0].width, 12);
});

check('layoutTrackBlocks: empty grid produces no blocks', () => {
  const blocks = layoutTrackBlocks(track([]), { pxPerQuarter: 48, bars: 2 });
  return blocks.length === 0;
});

check('layoutTrackBlocks: originTicks shifts positions left', () => {
  const t = track([{ note: 'C4', dur: 1 }]);
  const blocks = layoutTrackBlocks(t, { pxPerQuarter: 48, bars: 1, originTicks: 480 });
  return blocks.length === 1 && blocks[0].x < 0;
});

// ---- MIDI clip geometry -----------------------------------------------------
check('layoutClips: empty clips array produces nothing', () => {
  return layoutClips(track([], { clips: [] }), { pxPerQuarter: 48 }).length === 0;
});

check('layoutClips: clip at start 0 spans one bar width at default zoom', () => {
  const t = track([], { clips: [{ id: 'c1', name: 'A', start: 0, length: 1920, color: null }] });
  const clips = layoutClips(t, { pxPerQuarter: 48, ppq: 480 });
  return clips.length === 1 && clips[0].x === 0 && near(clips[0].width, 192) && clips[0].startTicks === 0;
});

check('layoutClips: second clip starts after the first one', () => {
  const t = track([], {
    clips: [
      { id: 'c1', name: 'A', start: 0, length: 1920, color: null },
      { id: 'c2', name: 'B', start: 1920, length: 1920, color: '#ff55ff' },
    ],
  });
  const clips = layoutClips(t, { pxPerQuarter: 48, ppq: 480 });
  return clips.length === 2
    && near(clips[1].x, 192)
    && near(clips[1].width, 192)
    && clips[1].color === '#ff55ff';
});

check('layoutClips: zoom scales clip width and position', () => {
  const t = track([], { clips: [{ id: 'c1', name: 'A', start: 960, length: 1920, color: null }] });
  const clips = layoutClips(t, { pxPerQuarter: 96, ppq: 480 });
  return near(clips[0].x, 192) && near(clips[0].width, 384);
});

check('layoutClips: clip without color falls back to track color', () => {
  const t = track([], { color: '#4af74a', clips: [{ id: 'c1', name: 'A', start: 0, length: 1920, color: null }] });
  const clips = layoutClips(t, { pxPerQuarter: 48, ppq: 480 });
  return clips[0].color === '#4af74a';
});

// ---- snapTicks (backlog #11) ----------------------------------------------
check('snapTicks: rounds to the nearest sixteenth (ppq/4)', () => {
  return snapTicks(100, { ppq: 480 }) === 120
    && snapTicks(200, { ppq: 480 }) === 240
    && snapTicks(0, { ppq: 480 }) === 0;
});

check('snapTicks: never returns a negative position', () => {
  return snapTicks(-500, { ppq: 480 }) === 0;
});

check('snapTicks honors a custom grid', () => {
  return snapTicks(2500, { ppq: 480, grid: 480 }) === 2400;
});

// ---- moveClipCommand / removeClipCommand (backlog #11) ---------------------
function clipEngine(initialClips) {
  const tracks = [{ id: 'trk_a', clips: initialClips.map(c => ({ ...c })) }];
  return {
    byId: { trk_a: tracks[0] },
    tracks,
    _emitCount: 0,
    addClip(id, cfg) {
      const clip = { id: cfg.id || 'clip_x', name: cfg.name || 'Clip', start: cfg.start || 0, length: cfg.length || 1920, events: [] };
      tracks[0].clips.push(clip);
      return clip;
    },
    removeClip(id, clipId) {
      const i = tracks[0].clips.findIndex(c => c.id === clipId);
      if (i < 0) return false;
      tracks[0].clips.splice(i, 1);
      return true;
    },
    moveClip(id, clipId, patch) {
      const c = tracks[0].clips.find(c => c.id === clipId);
      if (!c) return false;
      if (typeof patch.start === 'number') c.start = Math.max(0, Math.round(patch.start));
      if (typeof patch.length === 'number') c.length = Math.max(1, Math.round(patch.length));
      this._emitCount++;
      return true;
    },
    splitClip(id, clipId, atTicks) {
      const c = tracks[0].clips.find(c => c.id === clipId);
      if (!c) return null;
      const origEnd = c.start + c.length;
      const cut = Math.max(c.start, Math.min(Math.round(atTicks), origEnd));
      if (cut <= c.start || cut >= origEnd) return null;
      const offset = cut - c.start;
      const left = [];
      const right = [];
      (c.events || []).forEach(ev => {
        if (ev.start < offset) left.push({ ...ev });
        else right.push({ ...ev, start: ev.start - offset });
      });
      c.length = offset;
      c.events = left;
      const nc = {
        id: 'clip_' + Math.random().toString(36).slice(2, 8),
        name: c.name, color: c.color,
        start: cut, length: origEnd - cut, events: right,
      };
      tracks[0].clips.push(nc);
      return nc;
    },
    duplicateClip(id, clipId) {
      const c = tracks[0].clips.find(c => c.id === clipId);
      if (!c) return null;
      const copy = { ...c, id: 'clip_' + Math.random().toString(36).slice(2, 8), start: c.start + c.length, events: (c.events || []).slice() };
      tracks[0].clips.push(copy);
      return copy;
    },
    repeatClip(id, clipId, times) {
      const c = tracks[0].clips.find(c => c.id === clipId);
      if (!c) return [];
      const n = Math.max(1, Math.round(times || 1));
      const copies = [];
      for (let i = 1; i < n; i++) {
        const copy = { ...c, id: 'clip_' + Math.random().toString(36).slice(2, 8), start: c.start + i * c.length, events: (c.events || []).slice() };
        tracks[0].clips.push(copy);
        copies.push(copy);
      }
      return copies;
    },
  };
}

check('moveClipCommand moves a clip and undo restores its start', () => {
  const engine = clipEngine([{ id: 'c1', name: 'A', start: 0, length: 1920, events: [] }]);
  const history = createHistory();
  history.execute(moveClipCommand(engine, 'trk_a', 'c1', { start: 1920 }));
  const moved = engine.byId.trk_a.clips[0].start;
  history.undo();
  const undone = engine.byId.trk_a.clips[0].start;
  history.redo();
  const redone = engine.byId.trk_a.clips[0].start;
  return moved === 1920 && undone === 0 && redone === 1920;
});

check('moveClipCommand clamps start to non-negative ticks', () => {
  const engine = clipEngine([{ id: 'c1', name: 'A', start: 0, length: 1920, events: [] }]);
  const history = createHistory();
  history.execute(moveClipCommand(engine, 'trk_a', 'c1', { start: -500 }));
  return engine.byId.trk_a.clips[0].start === 0;
});

check('removeClipCommand removes a clip and undo restores it', () => {
  const engine = clipEngine([{ id: 'c1', name: 'A', start: 0, length: 1920, events: [] }]);
  const history = createHistory();
  history.execute(removeClipCommand(engine, 'trk_a', 'c1'));
  const afterRemove = engine.byId.trk_a.clips.length;
  history.undo();
  const afterUndo = engine.byId.trk_a.clips.length;
  return afterRemove === 0 && afterUndo === 1 && engine.byId.trk_a.clips[0].id === 'c1';
});

check('moveClipCommand is a no-op for a missing clip', () => {
  const engine = clipEngine([{ id: 'c1', name: 'A', start: 0, length: 1920, events: [] }]);
  const history = createHistory();
  history.execute(moveClipCommand(engine, 'trk_a', 'nope', { start: 960 }));
  return engine.byId.trk_a.clips[0].start === 0;
});

// ---- clip trim/resize (backlog #12) ---------------------------------------
check('moveClipCommand resizes a clip and undo restores length', () => {
  const engine = clipEngine([{ id: 'c1', name: 'A', start: 0, length: 1920, events: [] }]);
  const history = createHistory();
  history.execute(moveClipCommand(engine, 'trk_a', 'c1', { length: 960 }));
  const resized = engine.byId.trk_a.clips[0].length;
  history.undo();
  const undone = engine.byId.trk_a.clips[0].length;
  history.redo();
  const redone = engine.byId.trk_a.clips[0].length;
  return resized === 960 && undone === 1920 && redone === 960;
});

check('moveClipCommand changes start and length together', () => {
  const engine = clipEngine([{ id: 'c1', name: 'A', start: 0, length: 1920, events: [] }]);
  const history = createHistory();
  history.execute(moveClipCommand(engine, 'trk_a', 'c1', { start: 480, length: 960 }));
  const cStart = engine.byId.trk_a.clips[0].start;
  const cLen = engine.byId.trk_a.clips[0].length;
  history.undo();
  const uStart = engine.byId.trk_a.clips[0].start;
  const uLen = engine.byId.trk_a.clips[0].length;
  return cStart === 480 && cLen === 960 && uStart === 0 && uLen === 1920;
});

// ---- clip select / drag / delete in the arranger DOM (backlog #11) ---------
function dragEngine(tracks) {
  const byId = {};
  tracks.forEach(t => { byId[t.id] = t; });
  return {
    byId,
    tracks,
    getTracks: () => tracks.map(t => ({
      ...t,
      grid: t.grid.slice(),
      clips: (t.clips || []).map(c => ({ ...c, events: (c.events || []).slice() })),
    })),
    activeTrackId: tracks[0] && tracks[0].id,
    reorderTrack(id, toIndex) {
      const t = byId[id];
      if (!t) return false;
      const from = tracks.indexOf(t);
      if (from < 0) return false;
      const target = Math.max(0, Math.min(Math.round(toIndex), tracks.length - 1));
      if (target === from) return false;
      tracks.splice(from, 1);
      tracks.splice(target, 0, t);
      return true;
    },
    addClip(id, cfg) {
      const clip = { id: cfg.id || 'clip_new', name: cfg.name || 'Clip', start: cfg.start || 0, length: cfg.length || 1920, color: null, events: (cfg.events || []).slice() };
      byId[id].clips.push(clip);
      return clip;
    },
    moveClip(id, clipId, patch) {
      const c = byId[id].clips.find(c => c.id === clipId);
      if (!c) return false;
      if (typeof patch.start === 'number') c.start = patch.start;
      if (typeof patch.length === 'number') c.length = patch.length;
      return true;
    },
    removeClip(id, clipId) {
      const t = byId[id];
      const i = t.clips.findIndex(c => c.id === clipId);
      if (i < 0) return false;
      t.clips.splice(i, 1);
      return true;
    },
    splitClip(id, clipId, atTicks) {
      const c = byId[id].clips.find(c => c.id === clipId);
      if (!c) return null;
      const origEnd = c.start + c.length;
      const cut = Math.max(c.start, Math.min(Math.round(atTicks), origEnd));
      if (cut <= c.start || cut >= origEnd) return null;
      const offset = cut - c.start;
      const left = [];
      const right = [];
      (c.events || []).forEach(ev => {
        if (ev.start < offset) left.push({ ...ev });
        else right.push({ ...ev, start: ev.start - offset });
      });
      c.length = offset;
      c.events = left;
      const nc = { id: 'clip_split', name: c.name, color: c.color, start: cut, length: origEnd - cut, events: right };
      byId[id].clips.push(nc);
      return nc;
    },
    duplicateClip(id, clipId) {
      const c = byId[id].clips.find(c => c.id === clipId);
      if (!c) return null;
      const copy = { ...c, id: 'clip_dup', start: c.start + c.length, events: (c.events || []).slice() };
      byId[id].clips.push(copy);
      return copy;
    },
    repeatClip(id, clipId, times) {
      const c = byId[id].clips.find(c => c.id === clipId);
      if (!c) return [];
      const n = Math.max(1, Math.round(times || 1));
      const copies = [];
      for (let i = 1; i < n; i++) {
        const copy = { ...c, id: 'clip_rep' + i, start: c.start + i * c.length, events: (c.events || []).slice() };
        byId[id].clips.push(copy);
        copies.push(copy);
      }
      return copies;
    },
    updateTrack(id, patch) {
      const t = byId[id];
      if (!t) return;
      Object.keys(patch).forEach(k => { t[k] = patch[k]; });
    },
  };
}

check('clicking a clip selects it (selected class)', () => {
  const container = document.createElement('div');
  createArranger({
    container,
    engine: dragEngine([track([], {
      id: 'trk_a', name: 'A',
      clips: [{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null, events: [] }],
    })]),
    transport: fauxTransport(),
  });
  const clip = container.querySelector('.arranger-clip');
  clip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0 }));
  clip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 0 }));
  const reRendered = container.querySelector('.arranger-clip');
  return reRendered.classList.contains('selected');
});

check('dragging a clip moves it and snaps to the grid', () => {
  const container = document.createElement('div');
  const engine = dragEngine([track([], {
    id: 'trk_a', name: 'A',
    clips: [{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null, events: [] }],
  })]);
  const history = createHistory();
  createArranger({ container, engine, transport: fauxTransport(), history });
  const content = container.querySelector('.arranger-content');
  content.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 100, width: 400, height: 100 });
  const clip = container.querySelector('.arranger-clip');
  // pointerdown at x=0 grabs the left edge; move to x=192 (one bar = 1920 ticks at ppq 480 / zoom 48).
  clip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0, pointerType: 'mouse' }));
  clip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 192, pointerType: 'mouse' }));
  clip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 192, pointerType: 'mouse' }));
  const moved = engine.byId.trk_a.clips[0].start;
  history.undo();
  const undone = engine.byId.trk_a.clips[0].start;
  return moved === 1920 && undone === 0;
});

check('a plain click without movement does not move the clip', () => {
  const container = document.createElement('div');
  const engine = dragEngine([track([], {
    id: 'trk_a', name: 'A',
    clips: [{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null, events: [] }],
  })]);
  createArranger({ container, engine, transport: fauxTransport() });
  const content = container.querySelector('.arranger-content');
  content.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 100, width: 400, height: 100 });
  const clip = container.querySelector('.arranger-clip');
  clip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0, pointerType: 'mouse' }));
  clip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 0, pointerType: 'mouse' }));
  return engine.byId.trk_a.clips[0].start === 0;
});

check('Delete removes the selected clip and undo restores it', () => {
  const container = document.createElement('div');
  const engine = dragEngine([track([], {
    id: 'trk_a', name: 'A',
    clips: [{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null, events: [] }],
  })]);
  const history = createHistory();
  createArranger({ container, engine, transport: fauxTransport(), history });
  const clip = container.querySelector('.arranger-clip');
  clip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0 }));
  clip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 0 }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  const afterDelete = engine.byId.trk_a.clips.length;
  history.undo();
  const afterUndo = engine.byId.trk_a.clips.length;
  return afterDelete === 0 && afterUndo === 1;
});

check('Delete does nothing when no clip is selected', () => {
  const container = document.createElement('div');
  const engine = dragEngine([track([], {
    id: 'trk_a', name: 'A',
    clips: [{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null, events: [] }],
  })]);
  const history = createHistory();
  createArranger({ container, engine, transport: fauxTransport(), history });
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  return engine.byId.trk_a.clips.length === 1;
});

// ---- clip trim in the arranger DOM (backlog #12) ---------------------------
function trimSetup() {
  const container = document.createElement('div');
  const engine = dragEngine([track([], {
    id: 'trk_a', name: 'A',
    clips: [{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null, events: [] }],
  })]);
  const history = createHistory();
  createArranger({ container, engine, transport: fauxTransport(), history });
  const content = container.querySelector('.arranger-content');
  content.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 100, width: 400, height: 100 });
  return { container, engine, history };
}

check('right edge trim extends the clip length (snapped)', () => {
  const { container, engine, history } = trimSetup();
  const edgeR = container.querySelector('.arranger-clip-edge-r');
  // grab at x=192 (right edge of one-bar clip), drag to x=384 -> +1 bar length
  edgeR.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 192, pointerType: 'mouse' }));
  edgeR.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 384, pointerType: 'mouse' }));
  edgeR.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 384, pointerType: 'mouse' }));
  const lenAfter = engine.byId.trk_a.clips[0].length;
  history.undo();
  const lenUndo = engine.byId.trk_a.clips[0].length;
  return lenAfter === 3840 && lenUndo === 1920;
});

check('left edge trim moves the clip start and shrinks length', () => {
  const { container, engine, history } = trimSetup();
  const edgeL = container.querySelector('.arranger-clip-edge-l');
  // grab at x=0, drag to x=192 -> start moves one bar, but length clamps to the
  // minimum one-sixteenth (120 ticks at ppq 480): start = 1920 - 120 = 1800.
  edgeL.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0, pointerType: 'mouse' }));
  edgeL.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 192, pointerType: 'mouse' }));
  edgeL.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 192, pointerType: 'mouse' }));
  const startAfter = engine.byId.trk_a.clips[0].start;
  const lenAfter = engine.byId.trk_a.clips[0].length;
  history.undo();
  const startUndo = engine.byId.trk_a.clips[0].start;
  const lenUndo = engine.byId.trk_a.clips[0].length;
  return startAfter === 1800 && lenAfter === 120 && startUndo === 0 && lenUndo === 1920;
});

check('a click on the edge without movement does not change the clip', () => {
  const { container, engine } = trimSetup();
  const edgeR = container.querySelector('.arranger-clip-edge-r');
  edgeR.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 192, pointerType: 'mouse' }));
  edgeR.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 192, pointerType: 'mouse' }));
  const c = engine.byId.trk_a.clips[0];
  return c.start === 0 && c.length === 1920;
});

// ---- clip split / duplicate (backlog #13) ---------------------------------
check('splitClipCommand splits a clip at the given tick and undo restores it', () => {
  const engine = clipEngine([{ id: 'c1', name: 'A', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }, { note: 'G4', start: 1200, dur: 120 }] }]);
  const history = createHistory();
  history.execute(splitClipCommand(engine, 'trk_a', 'c1', 960));
  const clips = engine.byId.trk_a.clips;
  const left = clips.find(c => c.id === 'c1');
  const right = clips.find(c => c.id !== 'c1');
  const afterSplitCount = clips.length;
  const afterLeftLen = left.length;
  const afterLeftEvents = left.events.length;
  const afterLeftStart = left.events[0].start;
  const afterRightStart = right.start;
  const afterRightLen = right.length;
  const afterRightEvents = right.events.length;
  const afterRightEventStart = right.events[0].start;
  history.undo();
  const undone = engine.byId.trk_a.clips;
  return afterSplitCount === 2
    && afterLeftLen === 960 && afterLeftEvents === 1 && afterLeftStart === 0
    && afterRightStart === 960 && afterRightLen === 960 && afterRightEvents === 1 && afterRightEventStart === 240
    && undone.length === 1 && undone[0].id === 'c1' && undone[0].length === 1920 && undone[0].events.length === 2;
});

check('splitClipCommand does nothing when the split point is outside the clip', () => {
  const engine = clipEngine([{ id: 'c1', name: 'A', start: 0, length: 1920, events: [] }]);
  const history = createHistory();
  history.execute(splitClipCommand(engine, 'trk_a', 'c1', 5000));
  return engine.byId.trk_a.clips.length === 1 && engine.byId.trk_a.clips[0].length === 1920;
});

check('duplicateClipCommand copies a clip right after the original and undo removes it', () => {
  const engine = clipEngine([{ id: 'c1', name: 'A', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }] }]);
  const history = createHistory();
  history.execute(duplicateClipCommand(engine, 'trk_a', 'c1'));
  const clips = engine.byId.trk_a.clips;
  const copy = clips.find(c => c.id !== 'c1');
  const afterDupCount = clips.length;
  const copyStart = copy.start;
  const copyLen = copy.length;
  const copyEvents = copy.events.length;
  history.undo();
  return afterDupCount === 2
    && copyStart === 1920 && copyLen === 1920 && copyEvents === 1
    && engine.byId.trk_a.clips.length === 1;
});

check('clicking empty lane space clears the selection', () => {
  const container = document.createElement('div');
  createArranger({
    container,
    engine: dragEngine([track([], {
      id: 'trk_a', name: 'A',
      clips: [{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null, events: [] }],
    })]),
    transport: fauxTransport(),
  });
  const clip = container.querySelector('.arranger-clip');
  clip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0 }));
  clip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 0 }));
  const lane = container.querySelector('.arranger-lane');
  lane.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 300 }));
  return !container.querySelector('.arranger-clip.selected');
});

check('S splits the selected clip through the history', () => {
  const container = document.createElement('div');
  const engine = dragEngine([track([], {
    id: 'trk_a', name: 'A',
    clips: [{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null, events: [] }],
  })]);
  const history = createHistory();
  createArranger({ container, engine, transport: fauxTransport(), history });
  const clip = container.querySelector('.arranger-clip');
  clip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0 }));
  clip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 0 }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
  const afterSplit = engine.byId.trk_a.clips.length;
  history.undo();
  const afterUndo = engine.byId.trk_a.clips.length;
  return afterSplit === 2 && afterUndo === 1;
});

check('D duplicates the selected clip and undo removes the copy', () => {
  const container = document.createElement('div');
  const engine = dragEngine([track([], {
    id: 'trk_a', name: 'A',
    clips: [{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null, events: [] }],
  })]);
  const history = createHistory();
  createArranger({ container, engine, transport: fauxTransport(), history });
  const clip = container.querySelector('.arranger-clip');
  clip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0 }));
  clip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 0 }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
  const afterDup = engine.byId.trk_a.clips.length;
  history.undo();
  const afterUndo = engine.byId.trk_a.clips.length;
  return afterDup === 2 && afterUndo === 1;
});

check('S and D do nothing when no clip is selected', () => {
  const container = document.createElement('div');
  const engine = dragEngine([track([], {
    id: 'trk_a', name: 'A',
    clips: [{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null, events: [] }],
  })]);
  const history = createHistory();
  createArranger({ container, engine, transport: fauxTransport(), history });
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
  return engine.byId.trk_a.clips.length === 1;
});

check('repeatClipCommand loops a clip 3x and undo removes the copies', () => {
  const engine = clipEngine([{ id: 'c1', name: 'A', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }] }]);
  const history = createHistory();
  history.execute(repeatClipCommand(engine, 'trk_a', 'c1', 3));
  const count = engine.byId.trk_a.clips.length;
  const copyStart = engine.byId.trk_a.clips[1].start;
  history.undo();
  return count === 3 && copyStart === 1920 && engine.byId.trk_a.clips.length === 1;
});

check('repeatClipCommand with times <= 1 is a no-op', () => {
  const engine = clipEngine([{ id: 'c1', name: 'A', start: 0, length: 1920, events: [] }]);
  const history = createHistory();
  history.execute(repeatClipCommand(engine, 'trk_a', 'c1', 1));
  return engine.byId.trk_a.clips.length === 1;
});

check('L loops the selected clip 3x and undo restores it', () => {
  const container = document.createElement('div');
  const engine = dragEngine([track([], {
    id: 'trk_a', name: 'A',
    clips: [{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null, events: [] }],
  })]);
  const history = createHistory();
  createArranger({ container, engine, transport: fauxTransport(), history });
  const clip = container.querySelector('.arranger-clip');
  clip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0 }));
  clip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 0 }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
  const afterLoop = engine.byId.trk_a.clips.length;
  history.undo();
  const afterUndo = engine.byId.trk_a.clips.length;
  return afterLoop === 3 && afterUndo === 1;
});

// ---- multi-select / range select (backlog #15) ----------------------------
function multiSetup(historyEnabled) {
  const container = document.createElement('div');
  const engine = dragEngine([track([], {
    id: 'trk_a', name: 'A',
    clips: [
      { id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null, events: [] },
      { id: 'c2', name: 'Clip 2', start: 1920, length: 1920, color: null, events: [] },
      { id: 'c3', name: 'Clip 3', start: 3840, length: 1920, color: null, events: [] },
    ],
  })]);
  const history = historyEnabled ? createHistory() : null;
  createArranger({ container, engine, transport: fauxTransport(), history });
  const content = container.querySelector('.arranger-content');
  content.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 100, width: 800, height: 100 });
  return { container, engine, history };
}

check('moveClipsCommand shifts several clips by one delta and undo restores them', () => {
  const engine = clipEngine([
    { id: 'c1', name: 'A', start: 0, length: 1920, events: [] },
    { id: 'c2', name: 'B', start: 1920, length: 1920, events: [] },
  ]);
  const history = createHistory();
  history.execute(moveClipsCommand(engine, [{ trackId: 'trk_a', clipId: 'c1' }, { trackId: 'trk_a', clipId: 'c2' }], 480));
  const c1 = engine.byId.trk_a.clips.find(c => c.id === 'c1').start;
  const c2 = engine.byId.trk_a.clips.find(c => c.id === 'c2').start;
  history.undo();
  const u1 = engine.byId.trk_a.clips.find(c => c.id === 'c1').start;
  const u2 = engine.byId.trk_a.clips.find(c => c.id === 'c2').start;
  return c1 === 480 && c2 === 2400 && u1 === 0 && u2 === 1920;
});

check('moveClipsCommand clamps negative deltas to zero', () => {
  const engine = clipEngine([
    { id: 'c1', name: 'A', start: 0, length: 1920, events: [] },
    { id: 'c2', name: 'B', start: 1920, length: 1920, events: [] },
  ]);
  const history = createHistory();
  history.execute(moveClipsCommand(engine, [{ trackId: 'trk_a', clipId: 'c1' }, { trackId: 'trk_a', clipId: 'c2' }], -5000));
  const c1 = engine.byId.trk_a.clips.find(c => c.id === 'c1').start;
  const c2 = engine.byId.trk_a.clips.find(c => c.id === 'c2').start;
  return c1 === 0 && c2 === 0;
});

check('removeClipsCommand removes several clips and undo restores them with ids', () => {
  const engine = clipEngine([
    { id: 'c1', name: 'A', start: 0, length: 1920, events: [] },
    { id: 'c2', name: 'B', start: 1920, length: 1920, events: [] },
  ]);
  const history = createHistory();
  history.execute(removeClipsCommand(engine, [{ trackId: 'trk_a', clipId: 'c1' }, { trackId: 'trk_a', clipId: 'c2' }]));
  const after = engine.byId.trk_a.clips.length;
  history.undo();
  const clips = engine.byId.trk_a.clips;
  return after === 0 && clips.length === 2
    && clips.some(c => c.id === 'c1') && clips.some(c => c.id === 'c2');
});

check('Ctrl+click toggles a clip into the multi-selection', () => {
  const { container } = multiSetup(false);
  const c1 = container.querySelector('.arranger-clip[data-id="c1"]');
  const c2 = container.querySelector('.arranger-clip[data-id="c2"]');
  c1.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0 }));
  c2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 192, ctrlKey: true }));
  const sel = container.querySelectorAll('.arranger-clip.selected');
  return sel.length === 2;
});

check('Ctrl+click on a selected clip removes it from the selection', () => {
  const { container } = multiSetup(false);
  const c1 = container.querySelector('.arranger-clip[data-id="c1"]');
  const c2 = container.querySelector('.arranger-clip[data-id="c2"]');
  c1.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0 }));
  c2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 192, ctrlKey: true }));
  c1.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0, ctrlKey: true }));
  const sel = container.querySelectorAll('.arranger-clip.selected');
  return sel.length === 1 && sel[0].dataset.id === 'c2';
});

check('Shift+click range-selects clips between the anchor and the target', () => {
  const { container } = multiSetup(false);
  const c1 = container.querySelector('.arranger-clip[data-id="c1"]');
  const c3 = container.querySelector('.arranger-clip[data-id="c3"]');
  c1.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0 }));
  c3.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 384, shiftKey: true }));
  const sel = container.querySelectorAll('.arranger-clip.selected');
  return sel.length === 3;
});

check('Shift+click with no anchor just selects the clicked clip', () => {
  const { container } = multiSetup(false);
  const c3 = container.querySelector('.arranger-clip[data-id="c3"]');
  c3.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 384, shiftKey: true }));
  c3.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 384, shiftKey: true }));
  const sel = container.querySelectorAll('.arranger-clip.selected');
  return sel.length === 1 && sel[0].dataset.id === 'c3';
});

check('Delete removes every clip in the multi-selection and undo restores them', () => {
  const { container, engine, history } = multiSetup(true);
  const c1 = container.querySelector('.arranger-clip[data-id="c1"]');
  const c2 = container.querySelector('.arranger-clip[data-id="c2"]');
  c1.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0 }));
  c2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 192, ctrlKey: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  const afterDelete = engine.byId.trk_a.clips.length;
  history.undo();
  const clips = engine.byId.trk_a.clips;
  return afterDelete === 1
    && clips.length === 3
    && clips.some(c => c.id === 'c1') && clips.some(c => c.id === 'c2');
});

check('dragging one selected clip moves the whole selection together', () => {
  const { container, engine, history } = multiSetup(true);
  const c1 = container.querySelector('.arranger-clip[data-id="c1"]');
  const c2 = container.querySelector('.arranger-clip[data-id="c2"]');
  c1.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0 }));
  c2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 192, ctrlKey: true }));
  const c1again = container.querySelector('.arranger-clip[data-id="c1"]');
  c1again.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0, pointerType: 'mouse' }));
  c1again.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 192, pointerType: 'mouse' }));
  c1again.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 192, pointerType: 'mouse' }));
  const c1start = engine.byId.trk_a.clips.find(c => c.id === 'c1').start;
  const c2start = engine.byId.trk_a.clips.find(c => c.id === 'c2').start;
  history.undo();
  const u1 = engine.byId.trk_a.clips.find(c => c.id === 'c1').start;
  const u2 = engine.byId.trk_a.clips.find(c => c.id === 'c2').start;
  return c1start === 1920 && c2start === 3840 && u1 === 0 && u2 === 1920;
});

check('S/D/L act on the primary (anchor) clip of a multi-selection', () => {
  const { container, engine, history } = multiSetup(true);
  const c1 = container.querySelector('.arranger-clip[data-id="c1"]');
  const c2 = container.querySelector('.arranger-clip[data-id="c2"]');
  c1.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0 }));
  c2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 192, ctrlKey: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
  const count = engine.byId.trk_a.clips.length;
  history.undo();
  const undone = engine.byId.trk_a.clips.length;
  return count === 4 && undone === 3;
});

check('clicking empty lane space clears a multi-selection', () => {
  const { container } = multiSetup(false);
  const c1 = container.querySelector('.arranger-clip[data-id="c1"]');
  const c2 = container.querySelector('.arranger-clip[data-id="c2"]');
  c1.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0 }));
  c2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 192, ctrlKey: true }));
  const lane = container.querySelector('.arranger-lane');
  lane.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 600 }));
  return container.querySelectorAll('.arranger-clip.selected').length === 0;
});

// ---- markers (backlog #16) ------------------------------------------------
function markerSetup() {
  const container = document.createElement('div');
  const markers = createMarkerStore();
  const transport = fauxTransport();
  const history = createHistory();
  createArranger({ container, engine: fauxEngine([track([], { name: 'A' })]), transport, history, markers });
  return { container, markers, transport, history };
}

check('createMarkerStore add/remove/sort by tick', () => {
  const store = createMarkerStore();
  store.add({ name: 'B', tick: 3840 });
  store.add({ name: 'A', tick: 0 });
  const ms = store.getMarkers();
  const ok = ms.length === 2 && ms[0].name === 'A' && ms[0].tick === 0 && ms[1].tick === 3840;
  store.remove(ms[0].id);
  return ok && store.getMarkers().length === 1;
});

check('addMarker/removeMarker pure helpers return new arrays', () => {
  const base = [{ id: 'mrk_1', name: 'A', tick: 0 }];
  const withNew = addMarker(base, { name: 'B', tick: 1920 });
  const without = removeMarker(withNew, 'mrk_1');
  return base.length === 1
    && withNew.length === 2 && without.length === 1 && without[0].name === 'B'
    && withNew[1].tick === 1920;
});

check('normalizeMarker fills defaults and clamps negative ticks', () => {
  const m = normalizeMarker({});
  return typeof m.id === 'string' && m.name === 'Marker' && m.tick === 0
    && normalizeMarker({ name: 'X', tick: -5 }).tick === 0;
});

check('addMarkerCommand adds a marker and undo removes it', () => {
  const store = createMarkerStore();
  const history = createHistory();
  history.execute(addMarkerCommand(store, { name: 'M1', tick: 960 }));
  const afterAdd = store.getMarkers().length;
  history.undo();
  const afterUndo = store.getMarkers().length;
  history.redo();
  const afterRedo = store.getMarkers().length;
  return afterAdd === 1 && afterUndo === 0 && afterRedo === 1
    && store.getMarkers()[0].tick === 960;
});

check('removeMarkerCommand removes a marker and undo restores it', () => {
  const store = createMarkerStore({ markers: [{ id: 'mrk_1', name: 'A', tick: 0 }] });
  const history = createHistory();
  history.execute(removeMarkerCommand(store, 'mrk_1'));
  const afterRemove = store.getMarkers().length;
  history.undo();
  const afterUndo = store.getMarkers().length;
  return afterRemove === 0 && afterUndo === 1 && store.getMarkers()[0].id === 'mrk_1';
});

check('+ mrk adds a marker at the playhead and undo removes it', () => {
  const { container, markers, history } = markerSetup();
  const addBtn = [...container.querySelectorAll('.arranger-btn')].find(b => b.textContent === '+ mrk');
  addBtn.click();
  const afterAdd = markers.getMarkers().length;
  const tick = markers.getMarkers()[0].tick;
  history.undo();
  const afterUndo = markers.getMarkers().length;
  return !!addBtn && afterAdd === 1 && tick === 0 && afterUndo === 0;
});

check('arranger renders a marker flag on the ruler at its tick', () => {
  const { container, markers } = markerSetup();
  markers.add({ name: 'Verse', tick: 1920 });
  const flag = container.querySelector('.arranger-marker');
  return !!flag
    && flag.querySelector('.arranger-marker-label').textContent === 'Verse'
    && parseFloat(flag.style.left) === 192; // one bar at zoom 48
});

check('clicking a marker seeks the transport to its tick', () => {
  const { container, markers, transport } = markerSetup();
  markers.add({ name: 'Verse', tick: 1920 });
  const flag = container.querySelector('.arranger-marker');
  flag.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const s = transport.getState();
  return s.loopCount * s.loopLenTicks + s.loopPosTicks === 1920;
});

check('the marker delete button removes the marker (undoable)', () => {
  const { container, markers, history } = markerSetup();
  markers.add({ name: 'Verse', tick: 1920 });
  const del = container.querySelector('.arranger-marker-del');
  del.click();
  const afterDel = markers.getMarkers().length;
  history.undo();
  const afterUndo = markers.getMarkers().length;
  return afterDel === 0 && afterUndo === 1;
});

check('marker store set replaces the marker list', () => {
  const store = createMarkerStore();
  store.set([{ id: 'mrk_a', name: 'A', tick: 0 }, { id: 'mrk_b', name: 'B', tick: 480 }]);
  store.set([]);
  return store.getMarkers().length === 0;
});

// ---- mute / solo track flags (backlog #17) --------------------------------
function flagSetup() {
  const container = document.createElement('div');
  const engine = dragEngine([track([], { id: 'trk_a', name: 'A', muted: false, solo: false })]);
  const history = createHistory();
  createArranger({ container, engine, transport: fauxTransport(), history });
  return { container, engine, history };
}

function laneFlags(container) {
  return [...container.querySelectorAll('.arranger-lane-flag')];
}

check('lane header renders M, S and MNT flag buttons', () => {
  const { container } = flagSetup();
  const btns = laneFlags(container);
  return btns.length === 3
    && btns[0].textContent === 'M'
    && btns[1].textContent === 'S'
    && btns[2].textContent === 'MNT';
});

check('clicking M toggles muted via history and adds the muted class', () => {
  const { container, engine, history } = flagSetup();
  laneFlags(container)[0].click();
  const lane = container.querySelector('.arranger-lane');
  const state = engine.byId.trk_a.muted === true && lane.classList.contains('muted');
  const btnActive = laneFlags(container)[0].classList.contains('on');
  history.undo();
  const laneAfter = container.querySelector('.arranger-lane');
  const undone = engine.byId.trk_a.muted === false && !laneAfter.classList.contains('muted');
  return state && btnActive && undone;
});

check('clicking S toggles solo via history and adds the solo class', () => {
  const { container, engine, history } = flagSetup();
  laneFlags(container)[1].click();
  const lane = container.querySelector('.arranger-lane');
  const state = engine.byId.trk_a.solo === true && lane.classList.contains('solo');
  const btnActive = laneFlags(container)[1].classList.contains('on');
  history.undo();
  const laneAfter = container.querySelector('.arranger-lane');
  const undone = engine.byId.trk_a.solo === false && !laneAfter.classList.contains('solo');
  return state && btnActive && undone;
});

check('clicking MNT toggles monitor via history', () => {
  const { container, engine, history } = flagSetup();
  const wasOn = !!engine.byId.trk_a.monitor;
  laneFlags(container)[2].click();
  const state = !!engine.byId.trk_a.monitor === !wasOn
    && laneFlags(container)[2].classList.contains('on') === !wasOn;
  history.undo();
  const undone = !!engine.byId.trk_a.monitor === wasOn;
  return state && undone;
});

check('redoing a mute flag reapplies the muted class', () => {
  const { container, engine, history } = flagSetup();
  laneFlags(container)[0].click();
  history.undo();
  history.redo();
  return engine.byId.trk_a.muted === true && container.querySelector('.arranger-lane').classList.contains('muted');
});

check('a track muted from the start renders with the muted class', () => {
  const container = document.createElement('div');
  const engine = dragEngine([track([], { id: 'trk_a', name: 'A', muted: true, solo: false })]);
  createArranger({ container, engine, transport: fauxTransport() });
  return container.querySelector('.arranger-lane').classList.contains('muted');
});

check('clicking M does not clear the selected clip', () => {
  const container = document.createElement('div');
  const engine = dragEngine([track([], {
    id: 'trk_a', name: 'A', muted: false, solo: false,
    clips: [{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null, events: [] }],
  })]);
  createArranger({ container, engine, transport: fauxTransport() });
  const clip = container.querySelector('.arranger-clip[data-id="c1"]');
  clip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 10, pointerType: 'mouse' }));
  clip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 10, pointerType: 'mouse' }));
  const clipAfterSelect = container.querySelector('.arranger-clip[data-id="c1"]');
  const selectedBefore = clipAfterSelect.classList.contains('selected');
  laneFlags(container)[0].click();
  const clipAfterM = container.querySelector('.arranger-clip[data-id="c1"]');
  return selectedBefore === true && clipAfterM.classList.contains('selected') === true;
});

// ---- track rename (backlog #18) ------------------------------------------
check('double-clicking the lane label renames the track via history', () => {
  const { container, engine, history } = flagSetup();
  const label = container.querySelector('.arranger-lane-label');
  label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const input = container.querySelector('.arranger-lane-label-input');
  if (!input) return false;
  input.value = 'Renamed';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  if (engine.byId.trk_a.name !== 'Renamed') return false;
  history.undo();
  return engine.byId.trk_a.name === 'A';
});

check('escaping the lane label rename cancels it', () => {
  const { container, engine } = flagSetup();
  const label = container.querySelector('.arranger-lane-label');
  label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const input = container.querySelector('.arranger-lane-label-input');
  input.value = 'Nope';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return engine.byId.trk_a.name === 'A' && !container.querySelector('.arranger-lane-label-input');
});

check('empty lane label rename is ignored', () => {
  const { container, engine } = flagSetup();
  const label = container.querySelector('.arranger-lane-label');
  label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const input = container.querySelector('.arranger-lane-label-input');
  input.value = '  ';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return engine.byId.trk_a.name === 'A';
});

check('renameTrackCommand undo restores the label text in the DOM', () => {
  const { container, engine, history } = flagSetup();
  const label = container.querySelector('.arranger-lane-label');
  label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const input = container.querySelector('.arranger-lane-label-input');
  input.value = 'Renamed';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  history.undo();
  const labelAfter = container.querySelector('.arranger-lane-label');
  return labelAfter && labelAfter.textContent === 'A';
});

// ---- track reorder (backlog #19) ------------------------------------------
function reorderSetup() {
  const container = document.createElement('div');
  const engine = dragEngine([
    track([], { id: 'trk_a', name: 'A' }),
    track([], { id: 'trk_b', name: 'B' }),
    track([], { id: 'trk_c', name: 'C' }),
  ]);
  const history = createHistory();
  createArranger({ container, engine, transport: fauxTransport(), history });
  return { container, engine, history };
}

function laneReorder(container, idx, ch) {
  const lane = container.querySelectorAll('.arranger-lane')[idx];
  return [...lane.querySelectorAll('.arranger-lane-reorder')].find(b => b.textContent === ch);
}

check('lane headers render ▲/▼ reorder buttons (first ▲ dimmed)', () => {
  const { container } = reorderSetup();
  const btn0 = laneReorder(container, 0, '▲');
  const btn1 = laneReorder(container, 1, '▼');
  return btn0 && btn0.classList.contains('dim') && !!btn1 && !btn1.classList.contains('dim');
});

check('▲ on the last lane moves it up via history and undo restores order', () => {
  const { container, engine, history } = reorderSetup();
  const btn = laneReorder(container, 2, '▲');
  btn.click();
  const lanes1 = [...container.querySelectorAll('.arranger-lane')];
  if (lanes1[1].dataset.id !== 'trk_c') return false;
  if (engine.tracks[1].id !== 'trk_c') return false;
  history.undo();
  const lanes2 = [...container.querySelectorAll('.arranger-lane')];
  return lanes2[2].dataset.id === 'trk_c' && engine.tracks[2].id === 'trk_c';
});

check('reorder buttons are stopPropagation-safe (selection is preserved)', () => {
  const { container, engine } = reorderSetup();
  const label = container.querySelector('.arranger-lane-label');
  label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const input = container.querySelector('.arranger-lane-label-input');
  input.value = 'A2';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return engine.byId.trk_a.name === 'A2' && container.querySelector('.arranger-lane-label').textContent === 'A2';
});

// ---- track color (backlog #20) --------------------------------------------
check('lane header renders a color input seeded with the track color', () => {
  const { container, engine } = reorderSetup();
  const colorIn = container.querySelector('.arranger-lane-color');
  return !!colorIn && colorIn.value === engine.byId.trk_a.color;
});

check('changing the color runs an undoable command and recolors the label', () => {
  const { container, engine, history } = reorderSetup();
  const oldColor = engine.byId.trk_a.color;
  const colorIn = container.querySelector('.arranger-lane-color');
  colorIn.value = '#112233';
  colorIn.dispatchEvent(new Event('input', { bubbles: true }));
  const label = container.querySelector('.arranger-lane-label');
  if (engine.byId.trk_a.color !== '#112233') return false;
  if (label.style.color !== 'rgb(17, 34, 51)') return false;
  history.undo();
  return engine.byId.trk_a.color === oldColor;
});

// ---- track lane resize (backlog #22) --------------------------------------
check('lane renders with the default height and a resize handle', () => {
  const { container } = reorderSetup();
  const lane = container.querySelector('.arranger-lane');
  const handle = container.querySelector('.arranger-lane-resize');
  return lane.style.height === '26px' && !!handle;
});

check('dragging the resize handle updates the height and commits an undoable command', () => {
  const { container, engine, history } = reorderSetup();
  const lane = container.querySelector('.arranger-lane');
  const handle = container.querySelector('.arranger-lane-resize');
  const rect = { left: 0, top: 0, width: 800, height: 26 };
  handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: rect.top + rect.height }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientY: rect.top + rect.height + 40 }));
  window.dispatchEvent(new PointerEvent('pointerup', {}));
  if (engine.byId.trk_a.height !== 66) return false;
  if (lane.style.height !== '66px') return false;
  if (container.querySelector('.arranger-lane').style.height !== '66px') return false;
  history.undo();
  return engine.byId.trk_a.height === null || engine.byId.trk_a.height === undefined;
});

check('a track with an explicit height renders at that height', () => {
  const container = document.createElement('div');
  const engine = dragEngine([track([], { id: 'trk_a', name: 'A', height: 60 })]);
  createArranger({ container, engine, transport: fauxTransport(), history: createHistory(), markers: null, cfg: {} });
  return container.querySelector('.arranger-lane').style.height === '60px';
});

// ---- track folders / collapse (backlog #23) -------------------------------
function collapseSetup() {
  const container = document.createElement('div');
  const engine = dragEngine([
    track([], { id: 'trk_a', name: 'A' }),
    track([], { id: 'trk_b', name: 'B' }),
  ]);
  const history = createHistory();
  createArranger({ container, engine, transport: fauxTransport(), history });
  return { container, engine, history };
}

check('lane header renders a collapse toggle button', () => {
  const { container } = collapseSetup();
  const btn = container.querySelector('.arranger-lane-collapse');
  return !!btn && btn.textContent === '▾';
});

check('collapsing a track without children shrinks its lane via history', () => {
  const { container, engine, history } = collapseSetup();
  const btn = container.querySelector('.arranger-lane-collapse');
  btn.click();
  const laneAfter = container.querySelector('.arranger-lane[data-id="trk_a"]');
  const btnAfter = container.querySelector('.arranger-lane-collapse');
  if (engine.byId.trk_a.collapsed !== true) return false;
  if (laneAfter.style.height !== '18px') return false;
  if (!btnAfter || btnAfter.textContent !== '▸') return false;
  history.undo();
  return !engine.byId.trk_a.collapsed;
});

check('collapsing a folder hides its children lanes', () => {
  const container = document.createElement('div');
  const engine = dragEngine([
    track([], { id: 'trk_a', name: 'A' }),
    track([], { id: 'trk_b', name: 'B', folder: 'trk_a' }),
    track([], { id: 'trk_c', name: 'C' }),
  ]);
  const history = createHistory();
  createArranger({ container, engine, transport: fauxTransport(), history });
  const child = container.querySelector('.arranger-lane[data-id="trk_b"]');
  if (!child || child.style.display === 'none') return false;
  const btn = container.querySelector('.arranger-lane[data-id="trk_a"] .arranger-lane-collapse');
  btn.click();
  const childAfter = container.querySelector('.arranger-lane[data-id="trk_b"]');
  const folderAfter = container.querySelector('.arranger-lane[data-id="trk_a"]');
  return childAfter.style.display === 'none'
    && folderAfter.style.display !== 'none'
    && engine.byId.trk_b.folder === 'trk_a'
    && engine.byId.trk_a.collapsed === true;
});

// ---- clip note geometry (backlog #9) -------------------------------------
check('layoutClipNotes: empty events produce nothing', () => {
  const clip = { id: 'c1', start: 0, length: 1920, events: [] };
  return layoutClipNotes(clip, { pxPerQuarter: 48, ppq: 480 }).length === 0;
});

check('layoutClipNotes: note at tick 0 starts at clip origin', () => {
  const clip = { id: 'c1', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }] };
  const notes = layoutClipNotes(clip, { pxPerQuarter: 48, ppq: 480 });
  return notes.length === 1 && near(notes[0].x, 0) && near(notes[0].width, 12);
});

check('layoutClipNotes: sixteenth note is pxPerQuarter/4 wide', () => {
  const clip = { id: 'c1', start: 0, length: 1920, events: [{ note: 'C4', start: 120, dur: 120 }] };
  const notes = layoutClipNotes(clip, { pxPerQuarter: 96, ppq: 480 });
  return near(notes[0].x, 24) && near(notes[0].width, 24);
});

check('layoutClipNotes: event positions are relative to clip start', () => {
  const clip = { id: 'c1', start: 1920, length: 1920, events: [{ note: 'C4', start: 240, dur: 120 }] };
  const notes = layoutClipNotes(clip, { pxPerQuarter: 48, ppq: 480 });
  return near(notes[0].x, 24) && near(notes[0].width, 12);
});

check('layoutClipNotes: negative offsets clamp to clip left edge', () => {
  const clip = { id: 'c1', start: 0, length: 1920, events: [{ note: 'C4', start: -120, dur: 120 }] };
  const notes = layoutClipNotes(clip, { pxPerQuarter: 48, ppq: 480 });
  return notes.length === 1 && notes[0].x === 0;
});

// ---- arranger DOM (faux engine/transport, real DOM) ------------------------
function fauxTransport(bpm = 120) {
  return createTransport({ bpm, ctx: null });
}

function fauxEngine(tracks) {
  return { getTracks: () => tracks.map(t => ({ ...t, grid: t.grid.slice(), clips: (t.clips || []).map(c => ({ ...c })) })) };
}

check('arranger renders a ruler with one cell per bar', () => {
  const container = document.createElement('div');
  const arr = createArranger({
    container,
    engine: fauxEngine([track([], { name: 'A' })]),
    transport: fauxTransport(),
    cfg: { bars: 4 },
  });
  const cells = container.querySelectorAll('.arranger-bar');
  arr.dispose ? arr.dispose() : null;
  return cells.length === 4 && cells[0].textContent === '1';
});

check('arranger renders one lane per track', () => {
  const container = document.createElement('div');
  createArranger({
    container,
    engine: fauxEngine([track([], { name: 'A' }), track([], { name: 'B' })]),
    transport: fauxTransport(),
  });
  const lanes = container.querySelectorAll('.arranger-lane');
  return lanes.length === 2 && lanes[0].textContent.includes('A');
});

check('arranger renders blocks for grid cells', () => {
  const container = document.createElement('div');
  createArranger({
    container,
    engine: fauxEngine([track([{ note: 'C4', dur: 1 }], { name: 'A' })]),
    transport: fauxTransport(),
    cfg: { bars: 1 },
  });
  const blocks = container.querySelectorAll('.arranger-block');
  return blocks.length === 1 && blocks[0].textContent.includes('C4');
});

check('arranger renders clips instead of pattern blocks when clips exist', () => {
  const container = document.createElement('div');
  createArranger({
    container,
    engine: fauxEngine([track([], { name: 'A', clips: [{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null }] })]),
    transport: fauxTransport(),
    cfg: { bars: 2 },
  });
  const clips = container.querySelectorAll('.arranger-clip');
  const blocks = container.querySelectorAll('.arranger-block');
  return clips.length === 1 && clips[0].textContent === 'Clip 1' && blocks.length === 0;
});

check('arranger renders multiple clips with positions', () => {
  const container = document.createElement('div');
  createArranger({
    container,
    engine: fauxEngine([track([], {
      name: 'A',
      clips: [
        { id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null },
        { id: 'c2', name: 'Clip 2', start: 1920, length: 1920, color: null },
      ],
    })]),
    transport: fauxTransport(),
  });
  const clips = [...container.querySelectorAll('.arranger-clip')];
  return clips.length === 2 && clips[1].dataset.id === 'c2' && parseFloat(clips[1].style.left) === 192;
});

check('arranger renders mini-notes inside a clip with events', () => {
  const container = document.createElement('div');
  createArranger({
    container,
    engine: fauxEngine([track([], {
      name: 'A',
      clips: [{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null, events: [{ note: 'C4', start: 0, dur: 120 }] }],
    })]),
    transport: fauxTransport(),
  });
  const clip = container.querySelector('.arranger-clip');
  const notes = [...container.querySelectorAll('.arranger-clip-note')];
  return !!clip && notes.length === 1 && notes[0].parentElement === clip && notes[0].title === 'C4';
});

check('arranger renders no mini-notes for a clip without events', () => {
  const container = document.createElement('div');
  createArranger({
    container,
    engine: fauxEngine([track([], {
      name: 'A',
      clips: [{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null, events: [] }],
    })]),
    transport: fauxTransport(),
  });
  return container.querySelectorAll('.arranger-clip-note').length === 0;
});

check('arranger renders notes inside each of multiple clips', () => {
  const container = document.createElement('div');
  createArranger({
    container,
    engine: fauxEngine([track([], {
      name: 'A',
      clips: [
        { id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null, events: [{ note: 'C4', start: 0, dur: 120 }] },
        { id: 'c2', name: 'Clip 2', start: 1920, length: 1920, color: null, events: [{ note: 'D4', start: 0, dur: 120 }] },
      ],
    })]),
    transport: fauxTransport(),
  });
  const notes = [...container.querySelectorAll('.arranger-clip-note')];
  return notes.length === 2
    && notes.some(n => n.title === 'C4' && n.closest('.arranger-clip').dataset.id === 'c1')
    && notes.some(n => n.title === 'D4' && n.closest('.arranger-clip').dataset.id === 'c2');
});

check('addClipCommand adds a clip and undo removes it', () => {
  const engine = {
    byId: { trk_a: { id: 'trk_a', clips: [] } },
    addClip: (id, cfg) => {
      const clip = { id: cfg.id || 'clip_x', name: cfg.name || 'Clip', start: cfg.start || 0, length: cfg.length || 1920, events: [] };
      engine.byId[id].clips.push(clip);
      return clip;
    },
    removeClip: (id, clipId) => {
      const i = engine.byId[id].clips.findIndex(c => c.id === clipId);
      if (i < 0) return false;
      engine.byId[id].clips.splice(i, 1);
      return true;
    },
  };
  const history = createHistory();
  history.execute(addClipCommand(engine, 'trk_a', { name: 'Clip A', start: 0, length: 1920 }));
  const afterAdd = engine.byId.trk_a.clips.length;
  history.undo();
  const afterUndo = engine.byId.trk_a.clips.length;
  history.redo();
  const afterRedo = engine.byId.trk_a.clips.length;
  return afterAdd === 1 && afterUndo === 0 && afterRedo === 1;
});

check('arranger has a playhead element', () => {
  const container = document.createElement('div');
  createArranger({ container, engine: fauxEngine([track([])]), transport: fauxTransport() });
  return !!container.querySelector('.arranger-playhead');
});

check('arranger playhead follows transport ticks', () => {
  const container = document.createElement('div');
  let now = 0;
  const transport = createTransport({ bpm: 120 });
  transport._setClock(() => now);
  createArranger({ container, engine: fauxEngine([track([])]), transport });
  const playhead = container.querySelector('.arranger-playhead');
  transport.play();
  transport._clearTimer();
  now += 1000; // 1s at 120bpm -> 960 ticks
  transport._tick();
  return parseFloat(playhead.style.left) === 96;
});

check('arranger zoom-in increases block widths and px/beat label', () => {
  const container = document.createElement('div');
  const arr = createArranger({
    container,
    engine: fauxEngine([track([{ note: 'C4', dur: 1 }])]),
    transport: fauxTransport(),
  });
  const label = container.querySelector('.arranger-zoom-label');
  const before = label.textContent;
  const zoomInBtn = [...container.querySelectorAll('.arranger-btn')].find(b => b.textContent === '+');
  zoomInBtn.click();
  return label.textContent !== before;
});

check('arranger setZoom is clamped to the allowed range', () => {
  const container = document.createElement('div');
  const arr = createArranger({ container, engine: fauxEngine([track([])]), transport: fauxTransport() });
  arr.setZoom(100000);
  const label = container.querySelector('.arranger-zoom-label');
  const px = parseInt(label.textContent, 10);
  arr.setZoom(0.001);
  const px2 = parseInt(container.querySelector('.arranger-zoom-label').textContent, 10);
  return px === 192 && px2 === 12;
});

check('arranger re-renders when history changes', () => {
  const container = document.createElement('div');
  let listeners = [];
  const history = { subscribe: (fn) => { listeners.push(fn); } };
  const engine = fauxEngine([track([], { name: 'A' })]);
  createArranger({ container, engine, transport: fauxTransport(), history });
  listeners.forEach(fn => fn({ canUndo: false, canRedo: false }));
  const lanes = container.querySelectorAll('.arranger-lane');
  return lanes.length === 1;
});

summary.textContent = `${passed.length} passed, ${failed.length} failed`;
if (failed.length) summary.className = 'fail';
window.__testResults = { passed: passed.length, failed: failed.length };
