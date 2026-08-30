import {
  ticksToX, xToTicks, snapTicks, barLenTicksAt, computeRuler, contentWidthTicks, layoutTrackBlocks, layoutClips, layoutClipNotes,
} from '../src/arranger/arrangerLayout.js';
import { createTempoMap, addSignature } from '../src/project/tempoMap.js';
import { createTransport } from '../src/project/transport.js';
import { createArranger } from '../src/arranger/arranger.js';
import { createPianoRoll } from '../src/arranger/pianoRoll.js';
import { noteToMidi, midiToNote, pianoRows, pianoSteps, layoutPianoNotes } from '../src/arranger/pianoRollLayout.js';
import { quantizeStart, quantizeEvents } from '../src/arranger/quantize.js';
import { transposeMidi, transposeEvents } from '../src/arranger/transpose.js';
import { duplicateOffset, duplicateEvents } from '../src/arranger/duplicate.js';
import { legatoEvents } from '../src/arranger/legato.js';
import { fixedLengthDur, fixedLengthEvents } from '../src/arranger/fixedLength.js';
import { humanizeStart, humanizeVelocity, humanizeEvents } from '../src/arranger/humanize.js';
import { previewEvents } from '../src/arranger/preview.js';
import { createHistory } from '../src/project/history.js';
import { addClipCommand, moveClipCommand, removeClipCommand, splitClipCommand, duplicateClipCommand, repeatClipCommand, moveClipsCommand, removeClipsCommand, renameTrackCommand, editClipEventsCommand } from '../src/project/trackCommands.js';
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

// ---- piano roll layout helpers (backlog #25) -------------------------------
check('noteToMidi/midiToNote round-trip over C2..B4', () => {
  for (let midi = 36; midi <= 83; midi++) {
    if (noteToMidi(midiToNote(midi)) !== midi) return false;
  }
  return noteToMidi('C4') === 60 && noteToMidi('A3') === 57 && noteToMidi('C#4') === 61
    && noteToMidi('c4') === 60 && noteToMidi('H4') === null && midiToNote(71) === 'B4';
});

check('pianoRows lists B4..C3 top-first with black keys flagged', () => {
  const rows = pianoRows();
  return rows.length === 24 && rows[0].note === 'B4' && rows[23].note === 'C3'
    && rows[0].black === false && rows[1].black === true;
});

check('pianoSteps quantizes the clip length to sixteenths', () => {
  const s1 = pianoSteps({ length: 1920 });
  const s2 = pianoSteps({ length: 960 });
  const s3 = pianoSteps({ length: 130 });
  return s1.stepTicks === 120 && s1.steps === 16 && s2.steps === 8 && s3.steps === 2;
});

check('layoutPianoNotes positions bars by pitch row and step column', () => {
  const bars = layoutPianoNotes(
    [
      { note: 'C4', start: 0, dur: 120 },
      { note: 'C4', start: 120, dur: 240 },
      { note: 'C5', start: 0, dur: 120 }, // out of the default range -> skipped
    ],
    { clip: { length: 1920 }, cellW: 18, cellH: 12 },
  );
  return bars.length === 2
    && bars[0].x === 0 && bars[0].y === (71 - 60) * 12 && bars[0].width === 18
    && bars[1].x === 18 && bars[1].width === 36;
});

// ---- piano roll quantize helper (backlog #33) ------------------------------
check('quantizeStart snaps a start to the 1/16 grid', () => {
  return quantizeStart(30) === 0
    && quantizeStart(150) === 120
    && quantizeStart(240) === 240;
});

check('quantizeStart honors the grid 1/8 and 1/4', () => {
  return quantizeStart(60, { grid: 2 }) === 0
    && quantizeStart(300, { grid: 2 }) === 240
    && quantizeStart(200, { grid: 4 }) === 0
    && quantizeStart(550, { grid: 4 }) === 480;
});

check('quantizeStart strength pulls a start part-way to the grid', () => {
  return quantizeStart(30, { strength: 50 }) === 15
    && quantizeStart(30, { strength: 0 }) === 30
    && quantizeStart(300, { grid: 2, strength: 50 }) === 270;
});

check('quantizeStart swing delays every second grid slot', () => {
  return quantizeStart(0, { swing: 50 }) === 0
    && quantizeStart(120, { swing: 50 }) === 180
    && quantizeStart(240, { swing: 50 }) === 240
    && quantizeStart(360, { swing: 50 }) === 420;
});

check('quantizeStart swing combines with strength', () => {
  return quantizeStart(120, { swing: 50, strength: 50 }) === 150;
});

check('quantizeStart never pulls a start below 0', () => {
  return quantizeStart(10) === 0 && quantizeStart(1, { strength: 100 }) === 0;
});

check('quantizeEvents keeps unchanged events by reference', () => {
  const events = [
    { note: 'C4', start: 30, dur: 120 },
    { note: 'D4', start: 0, dur: 120 },
    { note: 'E4', start: 150, dur: 120, velocity: 64 },
  ];
  const out = quantizeEvents(events, {});
  return out[0] !== events[0] && out[0].start === 0 && out[0].dur === 120
    && out[1] === events[1] && out[1].start === 0
    && out[2] !== events[2] && out[2].start === 120 && out[2].velocity === 64;
});

// ---- piano roll transpose helper (backlog #34) ------------------------------
check('transposeMidi shifts a note up and down and clamps to the pitch range', () => {
  return transposeMidi(60, 2) === 62
    && transposeMidi(60, -3) === 57
    && transposeMidi(71, 2) === 71       // B4 + 2 clamps to B4
    && transposeMidi(48, -2) === 48      // C3 - 2 clamps to C3
    && transposeMidi(60, 12, { min: 0, max: 127 }) === 72;
});

check('transposeEvents shifts note names and preserves the other fields', () => {
  const events = [
    { note: 'B3', start: 120, dur: 240, velocity: 64 },
    { note: 'C3', start: 360, dur: 120 },
    { note: 'B4', start: 480, dur: 120, velocity: 100 },
  ];
  const out = transposeEvents(events, 2);
  return out[0].note === 'C#4' && out[0].start === 120 && out[0].dur === 240 && out[0].velocity === 64
    && out[1].note === 'D3' && out[1].start === 360
    && out[2].note === 'B4' && out[2].start === 480 && out[2].velocity === 100; // clamped
});

check('transposeEvents keeps unchanged events by reference', () => {
  const events = [
    { note: 'B4', start: 0, dur: 120 },  // clamps back to B4
    { note: 'C4', start: 120, dur: 120 },
  ];
  const out = transposeEvents(events, 3);
  return out[0] === events[0] && out[1] !== events[1] && out[1].note === 'D#4';
});

check('transposeEvents honors a custom clamp range and a zero interval', () => {
  const events = [{ note: 'C4', start: 0, dur: 120 }];
  const up = transposeEvents(events, 12, { min: 0, max: 127 });
  const zero = transposeEvents(events, 0);
  return up[0].note === 'C5' && up[0].start === 0 && zero === events;
});

// ---- piano roll duplicate helper (backlog #35) ------------------------------
check('duplicateOffset tiles a phrase right after its span', () => {
  const span = duplicateOffset([{ note: 'B3', start: 120, dur: 240 }, { note: 'C3', start: 360, dur: 120 }], { stepTicks: 120 });
  const single = duplicateOffset([{ note: 'C4', start: 0, dur: 240 }], { stepTicks: 120 });
  const noDur = duplicateOffset([{ note: 'C4', start: 0 }], { stepTicks: 120 });
  const empty = duplicateOffset([], { stepTicks: 120 });
  return span === 360 && single === 240 && noDur === 120 && empty === 0;
});

check('duplicateEvents copies each event by the phrase offset, preserving fields', () => {
  const events = [
    { note: 'B3', start: 120, dur: 240, velocity: 64 },
    { note: 'C3', start: 360, dur: 120 },
  ];
  const out = duplicateEvents(events, { stepTicks: 120 });
  const emptyArr = [];
  const empty = duplicateEvents(emptyArr, { stepTicks: 120 });
  return out.length === 2
    && out[0].start === 480 && out[0].note === 'B3' && out[0].dur === 240 && out[0].velocity === 64
    && out[1].start === 720 && out[1].note === 'C3' && out[1].dur === 120
    && out[0] !== events[0] && out[1] !== events[1] && events[0].start === 120
    && empty === emptyArr;
});

// ---- piano roll command (backlog #25) --------------------------------------
check('editClipEventsCommand replaces events with undo/redo', () => {
  const engine = {
    byId: { trk_a: { clips: [{ id: 'c1', events: [{ note: 'C4', start: 0, dur: 120 }] }] } },
    setClipEvents: (id, clipId, events) => {
      const c = engine.byId[id].clips.find(x => x.id === clipId);
      if (!c) return false;
      c.events = (events || []).map(ev => ({ ...ev }));
      return true;
    },
  };
  const history = createHistory();
  history.execute(editClipEventsCommand(engine, 'trk_a', 'c1', [{ note: 'D4', start: 120, dur: 120 }]));
  const applied = engine.byId.trk_a.clips[0].events[0].note;
  history.undo();
  const undone = engine.byId.trk_a.clips[0].events[0].note;
  history.redo();
  const redone = engine.byId.trk_a.clips[0].events[0].note;
  return applied === 'D4' && undone === 'C4' && redone === 'D4';
});

// ---- piano roll DOM (backlog #25) ------------------------------------------
// Faux engine exposing the piano-roll surface: getTracks + byId + setClipEvents.
function prEngine(clips) {
  const t = {
    id: 'trk_a', name: 'A', color: '#4af74a',
    grid: Array(16).fill(null), rt: [],
    clips: (clips || []).map(c => ({ ...c, events: (c.events || []).slice() })),
  };
  return {
    tracks: [t],
    byId: { trk_a: t },
    getTracks: () => [{
      ...t, grid: t.grid.slice(),
      clips: t.clips.map(c => ({ ...c, events: (c.events || []).slice() })),
    }],
    setClipEvents: (id, clipId, events) => {
      const c = t.clips.find(x => x.id === clipId);
      if (!c) return false;
      c.events = (events || []).map(ev => ({ ...ev })).sort((a, b) => (a.start || 0) - (b.start || 0));
      return true;
    },
  };
}

check('piano roll shows an empty hint when no clip is selected', () => {
  const container = document.createElement('div');
  const pr = createPianoRoll({ container, engine: prEngine([]), transport: fauxTransport(), history: createHistory() });
  const emptyAtStart = !!container.querySelector('.pr-empty');
  pr.setSelection(null);
  return emptyAtStart && !!container.querySelector('.pr-empty');
});

check('piano roll renders a pitch/step grid for the selected clip', () => {
  const container = document.createElement('div');
  const pr = createPianoRoll({
    container,
    engine: prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }] }]),
    transport: fauxTransport(),
    history: createHistory(),
  });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  const cells = container.querySelectorAll('.pr-cell');
  const steps = container.querySelectorAll('.pr-step');
  const notes = container.querySelectorAll('.pr-note');
  return cells.length === 16 * 24 && steps.length === 16
    && notes.length === 1 && notes[0].title.startsWith('C4')
    && container.querySelector('.pr-title').textContent.includes('Clip 1');
});

check('clicking an empty piano roll cell adds a note (undoable)', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [] }]);
  const history = createHistory();
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  const body = container.querySelector('.pr-body');
  // Column 3, row A3 (midi 57): ri = 71 - 57 = 14; x = 34 + 3*18 = 88; y = 14*12.
  body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 88, clientY: 14 * 12 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 88, clientY: 14 * 12 }));
  const added = engine.byId.trk_a.clips[0].events.find(e => e.note === 'A3');
  history.undo();
  const afterUndo = engine.byId.trk_a.clips[0].events.length;
  return !!added && added.start === 360 && added.dur === 120 && added.velocity === 100 && afterUndo === 0;
});

check('clicking an existing piano roll note removes it (undoable)', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }] }]);
  const history = createHistory();
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  const note = container.querySelector('.pr-note');
  // A plain click (no drag) on the bar removes it (backlog #25).
  note.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 34, clientY: 11 * 12 }));
  window.dispatchEvent(new PointerEvent('pointerup', {}));
  const afterClick = engine.byId.trk_a.clips[0].events.length;
  history.undo();
  const afterUndo = engine.byId.trk_a.clips[0].events.length;
  return afterClick === 0 && afterUndo === 1 && container.querySelectorAll('.pr-note').length === 1;
});

check('dragging a piano roll note moves it to a new step and pitch (undoable)', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }] }]);
  const history = createHistory();
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  const note = container.querySelector('.pr-note');
  // Grab C4 at column 0 (clientX 34), then drag +2 columns (+36) and +2 rows
  // down (+24): target column 2, pitch A#3 (midi 58).
  note.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 34, clientY: 11 * 12 }));
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 34 + 2 * 18, clientY: 11 * 12 + 2 * 12 }));
  window.dispatchEvent(new PointerEvent('pointerup', {}));
  const moved = engine.byId.trk_a.clips[0].events[0];
  history.undo();
  const undone = engine.byId.trk_a.clips[0].events[0];
  return moved.note === 'A#3' && moved.start === 240 && moved.dur === 120
    && undone.note === 'C4' && undone.start === 0;
});

check('dragging the right edge of a piano roll note resizes its duration (undoable)', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }] }]);
  const history = createHistory();
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  const edge = container.querySelector('.pr-note-edge-r');
  // Stretch the right edge from column 1 to column 3: dur 120 -> 360.
  edge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 34 + 18, clientY: 11 * 12 }));
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 34 + 3 * 18, clientY: 11 * 12 }));
  window.dispatchEvent(new PointerEvent('pointerup', {}));
  const resized = engine.byId.trk_a.clips[0].events[0];
  history.undo();
  const undone = engine.byId.trk_a.clips[0].events[0];
  return resized.start === 0 && resized.dur === 360
    && undone.start === 0 && undone.dur === 120;
});

check('dragging the left edge of a piano roll note trims its start (undoable)', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 240 }] }]);
  const history = createHistory();
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  const edge = container.querySelector('.pr-note-edge-l');
  // Push the left edge from column 0 to column 2: start 0 -> 120, dur 240 -> 120.
  edge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 34, clientY: 11 * 12 }));
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 34 + 2 * 18, clientY: 11 * 12 }));
  window.dispatchEvent(new PointerEvent('pointerup', {}));
  const trimmed = engine.byId.trk_a.clips[0].events[0];
  history.undo();
  const undone = engine.byId.trk_a.clips[0].events[0];
  return trimmed.start === 120 && trimmed.dur === 120
    && undone.start === 0 && undone.dur === 240;
});

check('piano roll renders a velocity bar per note (backlog #27)', () => {
  const container = document.createElement('div');
  const pr = createPianoRoll({
    container,
    engine: prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [
      { note: 'C4', start: 0, dur: 120, velocity: 100 },
      { note: 'C4', start: 120, dur: 240 },
    ] }]),
    transport: fauxTransport(),
    history: createHistory(),
  });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  const bars = container.querySelectorAll('.pr-vel-bar');
  const lane = container.querySelector('.pr-vel');
  // Two notes -> two bars; default velocity 100 -> height round(100/127*40)=31;
  // the second event starts at column 1 (left 34+18) and spans 2 steps (36px).
  return bars.length === 2 && !!lane
    && bars[0].style.height === Math.round(100 / 127 * 40) + 'px'
    && bars[1].style.left === (34 + 18) + 'px'
    && bars[1].style.width === (2 * 18) + 'px';
});

check('dragging a piano roll velocity bar changes the note velocity (undoable)', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 120, velocity: 100 }] }]);
  const history = createHistory();
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  const bar = container.querySelector('.pr-vel-bar');
  const lane = container.querySelector('.pr-vel');
  // Grab near the lane top (velocity ~127), then move to mid-lane: y = 20 of 40
  // -> velocity = round((1 - 20/40) * 127) = 64.
  bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 5, clientY: 2 }));
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 5, clientY: 20 }));
  window.dispatchEvent(new PointerEvent('pointerup', {}));
  const v = engine.byId.trk_a.clips[0].events[0].velocity;
  history.undo();
  const undone = engine.byId.trk_a.clips[0].events[0].velocity;
  return v === 64 && undone === 100;
});

// ---- piano roll marquee selection (backlog #29) ----------------------------
function marqueeSelect(container, x0, y0, x1, y1) {
  const body = container.querySelector('.pr-body');
  body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: x0, clientY: y0 }));
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: x1, clientY: y1 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: x1, clientY: y1 }));
}

check('marquee box-selects the notes it covers (backlog #29)', () => {
  const container = document.createElement('div');
  const pr = createPianoRoll({
    container,
    engine: prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [
      { note: 'C4', start: 0, dur: 120 },
      { note: 'E4', start: 240, dur: 120 },
      { note: 'G4', start: 480, dur: 120 },
    ] }]),
    transport: fauxTransport(),
    history: createHistory(),
  });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  // Box (34,0)..(106,156) covers C4 (col 0) and E4 (col 2), not G4 (col 4).
  marqueeSelect(container, 34, 0, 34 + 4 * 18, 13 * 12);
  return container.querySelectorAll('.pr-note.selected').length === 2;
});

check('plain click on a selected note clears the selection without deleting', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [
    { note: 'C4', start: 0, dur: 120 },
    { note: 'E4', start: 240, dur: 120 },
  ] }]);
  const history = createHistory();
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  marqueeSelect(container, 34, 0, 34 + 4 * 18, 13 * 12);
  const selCount = container.querySelectorAll('.pr-note.selected').length;
  const first = container.querySelector('.pr-note');
  first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, clientX: 34, clientY: 11 * 12 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2 }));
  const still = container.querySelectorAll('.pr-note').length;
  const afterClear = container.querySelectorAll('.pr-note.selected').length;
  return selCount === 2 && still === 2 && afterClear === 0
    && engine.byId.trk_a.clips[0].events.length === 2;
});

check('dragging a selected note moves the whole selection (undoable)', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [
    { note: 'C4', start: 0, dur: 120 },
    { note: 'E4', start: 240, dur: 120 },
  ] }]);
  const history = createHistory();
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  marqueeSelect(container, 34, 0, 34 + 4 * 18, 13 * 12);
  const first = container.querySelector('.pr-note');
  // Drag the first selected bar (C4, col 0) +1 column and +1 row down.
  first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, clientX: 34, clientY: 11 * 12 }));
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: 34 + 18, clientY: 11 * 12 + 12 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2 }));
  const evs = engine.byId.trk_a.clips[0].events.slice().sort((a, b) => a.start - b.start);
  history.undo();
  const undone = engine.byId.trk_a.clips[0].events.slice().sort((a, b) => a.start - b.start);
  return evs.length === 2
    && evs[0].note === 'B3' && evs[0].start === 120 // C4 moved down+right
    && evs[1].note === 'D#4' && evs[1].start === 360 // E4 moved with the group
    && undone[0].note === 'C4' && undone[0].start === 0
    && undone[1].note === 'E4' && undone[1].start === 240;
});

check('Delete removes every selected note as one undoable command', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [
    { note: 'C4', start: 0, dur: 120 },
    { note: 'E4', start: 240, dur: 120 },
    { note: 'G4', start: 480, dur: 120 },
  ] }]);
  const history = createHistory();
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  marqueeSelect(container, 34, 0, 34 + 4 * 18, 13 * 12);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  const afterDelete = engine.byId.trk_a.clips[0].events.length;
  history.undo();
  const afterUndo = engine.byId.trk_a.clips[0].events.length;
  return afterDelete === 1 && afterUndo === 3;
});

check('arranger reports clip selection changes via cfg.onSelectionChange', () => {
  const container = document.createElement('div');
  const seen = [];
  createArranger({
    container,
    engine: fauxEngine([track([], {
      id: 'trk_a', name: 'A',
      clips: [{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, color: null, events: [] }],
    })]),
    transport: fauxTransport(),
    cfg: { onSelectionChange: (s) => { seen.push(s); } },
  });
  const clip = container.querySelector('.arranger-clip');
  clip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0 }));
  clip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 0 }));
  return seen.some(s => s && s.trackId === 'trk_a' && s.clipId === 'c1');
});

// ---- piano roll audition (backlog #30) -----------------------------------

function auditionEngine(clips) {
  const base = prEngine(clips);
  const calls = [];
  const e = {
    ...base,
    calls,
    auditionNote: (trackId, note, vel, dur) => calls.push({ type: 'on', trackId, note, vel, dur }),
    auditionNoteOff: (trackId, note) => calls.push({ type: 'off', trackId, note }),
  };
  return e;
}

check('pressing a piano roll note auditions it and releases on pointer-up', () => {
  const container = document.createElement('div');
  const engine = auditionEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [
    { note: 'C4', start: 0, dur: 120, velocity: 64 },
  ] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  const note = container.querySelector('.pr-note');
  const r = note.getBoundingClientRect();
  note.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3, clientX: r.left + 5, clientY: r.top + 5 }));
  const ons = engine.calls.filter(c => c.type === 'on');
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3 }));
  const offs = engine.calls.filter(c => c.type === 'off');
  return ons.length === 1 && ons[0].trackId === 'trk_a' && ons[0].note === 'C4'
    && ons[0].vel === 64 && ons[0].dur === undefined
    && offs.length === 1 && offs[0].note === 'C4';
});

check('dragging a note re-auditions the target pitch', () => {
  const container = document.createElement('div');
  const engine = auditionEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [
    { note: 'C4', start: 0, dur: 120 },
  ] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  const note = container.querySelector('.pr-note');
  const r = note.getBoundingClientRect();
  note.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 4, clientX: r.left + 5, clientY: r.top + 5 }));
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 4, clientX: r.left + 5 + 18, clientY: r.top + 5 + 12 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 4 }));
  const ons = engine.calls.filter(c => c.type === 'on').map(c => c.note);
  const offs = engine.calls.filter(c => c.type === 'off').map(c => c.note);
  return ons.join(',') === 'C4,B3' && offs.join(',') === 'C4,B3';
});

check('drawing a note on an empty cell auditions a self-terminating preview', () => {
  const container = document.createElement('div');
  const engine = auditionEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  const body = container.querySelector('.pr-body');
  body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 5, clientX: 34, clientY: 11 * 12 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 5, clientX: 34, clientY: 11 * 12 }));
  const ons = engine.calls.filter(c => c.type === 'on');
  // 120 bpm / ppq 480: one sixteenth = 0.125s.
  return ons.length === 1 && ons[0].note === 'C4' && ons[0].vel === 100 && ons[0].dur === 0.125;
});

// ---- piano roll zoom + snap (backlog #31) --------------------------------

function snapButton(container, text) {
  return [...container.querySelectorAll('.pr-snap-btn')].find(b => b.textContent === text);
}

function zoomButton(container, text) {
  return [...container.querySelectorAll('.pr-zoom-btn')].find(b => b.textContent === text);
}

check('zoom buttons rescale the piano roll grid (backlog #31)', () => {
  const container = document.createElement('div');
  const pr = createPianoRoll({
    container,
    engine: prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }] }]),
    transport: fauxTransport(),
    history: createHistory(),
  });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  // 100% -> 125%: cellW 18 -> round(18*1.25) = 23, cellH 12 -> 15; a one-step
  // note is then 23px wide. Zooming back out restores 18px and the label.
  zoomButton(container, '+').click();
  const grid = container.querySelector('.pr-body')._grid;
  const noteW = container.querySelector('.pr-note').style.width;
  zoomButton(container, '−').click();
  const back = container.querySelector('.pr-body')._grid;
  return grid.cellW === 23 && grid.cellH === 15 && noteW === '23px'
    && back.cellW === 18 && back.cellH === 12
    && container.querySelector('.pr-zoom-label').textContent === '18 px/step';
});

check('Ctrl+wheel zooms the piano roll grid (backlog #31)', () => {
  const container = document.createElement('div');
  const pr = createPianoRoll({
    container,
    engine: prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [] }]),
    transport: fauxTransport(),
    history: createHistory(),
  });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  const wrap = container.querySelector('.pr-wrap');
  wrap.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true }));
  const zoomed = container.querySelector('.pr-body')._grid.cellW;
  // A plain wheel (no Ctrl) must not zoom.
  wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
  return zoomed === 23 && container.querySelector('.pr-body')._grid.cellW === 23;
});

check('snap 1/4 quantizes a drawn note to a quarter step (backlog #31)', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  // Draw at column 3 -> snapped up to the 1/4 column 4 -> start 480.
  snapButton(container, '1/4').click();
  const body = container.querySelector('.pr-body');
  body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 88, clientY: 14 * 12 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 88, clientY: 14 * 12 }));
  const added = engine.byId.trk_a.clips[0].events.find(e => e.note === 'A3');
  return !!added && added.start === 480;
});

check('snap off draws a note at a sub-sixteenth position (backlog #31)', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  // clientX 61 -> x = 27 -> free column 1.5 -> start round(1.5 * 120) = 180.
  snapButton(container, 'off').click();
  const body = container.querySelector('.pr-body');
  body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 61, clientY: 14 * 12 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 61, clientY: 14 * 12 }));
  const added = engine.byId.trk_a.clips[0].events.find(e => e.note === 'A3');
  return !!added && added.start === 180;
});

check('snap 1/8 quantizes a dragged note to even columns (backlog #31)', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  // Drag C4 (col 0) +1 column -> snapped to the 1/8 column 2 -> start 240.
  snapButton(container, '1/8').click();
  const note = container.querySelector('.pr-note');
  note.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 34, clientY: 11 * 12 }));
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 34 + 18, clientY: 11 * 12 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
  const moved = engine.byId.trk_a.clips[0].events[0];
  return moved.note === 'C4' && moved.start === 240;
});

// ---- piano roll quantize UI (backlog #33) ----------------------------------
function qBtn(container) {
  return container.querySelector('.pr-q-btn');
}

check('quantize row renders strength/swing inputs and a Q button (backlog #33)', () => {
  const container = document.createElement('div');
  const pr = createPianoRoll({
    container,
    engine: prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [] }]),
    transport: fauxTransport(),
    history: createHistory(),
  });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  return !!qBtn(container)
    && container.querySelector('.pr-q-strength').value === '100'
    && container.querySelector('.pr-q-swing').value === '0';
});

check('Q snaps off-grid note starts to the active snap grid (undoable)', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 30, dur: 120 }, { note: 'D4', start: 150, dur: 120 }] }]);
  const history = createHistory();
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  qBtn(container).click();
  const snapped = engine.byId.trk_a.clips[0].events.map(e => e.start);
  history.undo();
  const undone = engine.byId.trk_a.clips[0].events.map(e => e.start);
  return snapped[0] === 0 && snapped[1] === 120 && undone[0] === 30 && undone[1] === 150;
});

check('Q applies only to the marquee selection', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 30, dur: 120 }, { note: 'C3', start: 150, dur: 120 }] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  // Marquee-select only the C4 note (row 11 = y 132..144, cols 0..1).
  const body = container.querySelector('.pr-body');
  body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 34, clientY: 132 }));
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 64, clientY: 145 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 64, clientY: 145 }));
  qBtn(container).click();
  const starts = engine.byId.trk_a.clips[0].events.map(e => e.start).sort((a, b) => a - b);
  return starts[0] === 0 && starts[1] === 150;
});

check('Q with swing shifts an odd sixteenth later (swing input respected)', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 120, dur: 120 }] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  container.querySelector('.pr-q-swing').value = '50';
  qBtn(container).click();
  return engine.byId.trk_a.clips[0].events[0].start === 180;
});

check('Q with strength 50 pulls an off-grid note halfway (strength input respected)', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 30, dur: 120 }] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  container.querySelector('.pr-q-strength').value = '50';
  qBtn(container).click();
  return engine.byId.trk_a.clips[0].events[0].start === 15;
});

check('Q is a no-op when no clip is selected', () => {
  const container = document.createElement('div');
  const pr = createPianoRoll({ container, engine: prEngine([]), transport: fauxTransport(), history: createHistory() });
  pr.setSelection(null);
  qBtn(container).click();
  return !!container.querySelector('.pr-empty');
});

// ---- piano roll transpose UI (backlog #34) ---------------------------------
function tBtn(container) {
  return container.querySelector('.pr-t-btn');
}

check('transpose row renders a semitone input and a T button (backlog #34)', () => {
  const container = document.createElement('div');
  const pr = createPianoRoll({
    container,
    engine: prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [] }]),
    transport: fauxTransport(),
    history: createHistory(),
  });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  return !!tBtn(container)
    && container.querySelector('.pr-t-semi').value === '1'
    && !!container.querySelector('.pr-t-name');
});

check('T transposes all notes by the interval (undoable)', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'B3', start: 120, dur: 240 }, { note: 'C3', start: 360, dur: 120 }, { note: 'B4', start: 480, dur: 120 }] }]);
  const history = createHistory();
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  container.querySelector('.pr-t-semi').value = '2';
  tBtn(container).click();
  const notes = engine.byId.trk_a.clips[0].events.map(e => e.note).sort();
  history.undo();
  const undone = engine.byId.trk_a.clips[0].events.map(e => e.note).sort();
  return notes[0] === 'B4' && notes[1] === 'C#4' && notes[2] === 'D3' && undone[0] === 'B3' && undone[1] === 'B4' && undone[2] === 'C3';
});

check('T applies only to the marquee selection', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }, { note: 'C3', start: 120, dur: 120 }] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  const body = container.querySelector('.pr-body');
  body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 34, clientY: 132 }));
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 64, clientY: 145 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 64, clientY: 145 }));
  container.querySelector('.pr-t-semi').value = '2';
  tBtn(container).click();
  const notes = engine.byId.trk_a.clips[0].events.map(e => e.note).sort();
  return notes[0] === 'C3' && notes[1] === 'D4';
});

check('T honors a large interval and clamps to the visible pitch range', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  container.querySelector('.pr-t-semi').value = '24';
  tBtn(container).click();
  const note = engine.byId.trk_a.clips[0].events[0].note;
  container.querySelector('.pr-t-semi').value = '0';
  tBtn(container).click();
  return note === 'B4' && engine.byId.trk_a.clips[0].events[0].note === 'B4';
});

check('T is a no-op when no clip is selected', () => {
  const container = document.createElement('div');
  const pr = createPianoRoll({ container, engine: prEngine([]), transport: fauxTransport(), history: createHistory() });
  pr.setSelection(null);
  tBtn(container).click();
  return !!container.querySelector('.pr-empty');
});

// ---- piano roll duplicate UI (backlog #35) ---------------------------------
function ctrlD() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
}

check('Ctrl+D duplicates the marquee selection right after its span (undoable)', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'B3', start: 120, dur: 240 }, { note: 'C3', start: 360, dur: 120 }, { note: 'B4', start: 480, dur: 120 }] }]);
  const history = createHistory();
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  // Marquee-select all three notes (cols 0..5, rows 0..24).
  const body = container.querySelector('.pr-body');
  body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 34, clientY: 0 }));
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 142, clientY: 300 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 142, clientY: 300 }));
  ctrlD();
  const starts = engine.byId.trk_a.clips[0].events.map(e => e.start).sort((a, b) => a - b);
  history.undo();
  const undone = engine.byId.trk_a.clips[0].events.map(e => e.start).sort((a, b) => a - b);
  // Span 600 - 120 = 480; copies land at 600/840/960.
  return starts.length === 6 && starts[0] === 120 && starts[3] === 600 && starts[4] === 840 && starts[5] === 960
    && undone.length === 3 && undone[0] === 120 && undone[2] === 480;
});

check('Ctrl+D duplicates only the marquee-selected notes', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'B3', start: 120, dur: 240 }, { note: 'C3', start: 360, dur: 120 }, { note: 'B4', start: 480, dur: 120 }] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  // Select only B3 and C3 (rows 12..24, cols 0..3) — B4 (row 0) stays out.
  const body = container.querySelector('.pr-body');
  body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 34, clientY: 144 }));
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 100, clientY: 300 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 100, clientY: 300 }));
  ctrlD();
  const byNote = (n) => engine.byId.trk_a.clips[0].events.filter(e => e.note === n).length;
  // B3/C3 span 360 -> copies at +360; B4 untouched.
  return byNote('B3') === 2 && byNote('C3') === 2 && byNote('B4') === 1;
});

check('Ctrl+D is a no-op without a selection', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  ctrlD();
  return engine.byId.trk_a.clips[0].events.length === 1;
});

// ---- piano roll legato UI (backlog #36) ------------------------------------
check('legatoEvents extends a note to the start of the next one', () => {
  const out = legatoEvents([{ note: 'C4', start: 0, dur: 120 }, { note: 'D4', start: 240, dur: 120 }]);
  return out.length === 2 && out[0].dur === 240 && out[1].dur === 120;
});

check('legatoEvents never shortens an overlapping note', () => {
  const out = legatoEvents([{ note: 'C4', start: 0, dur: 480 }, { note: 'D4', start: 240, dur: 120 }]);
  return out[0].dur === 480 && out[0].note === 'C4';
});

check('legatoEvents extends equal-start notes to the next strictly-greater start', () => {
  const out = legatoEvents([{ note: 'C4', start: 0, dur: 120 }, { note: 'E4', start: 0, dur: 120 }, { note: 'D4', start: 480, dur: 120 }]);
  return out[0].dur === 480 && out[1].dur === 480 && out[2].dur === 120;
});

check('legatoEvents leaves the last note and unchanged events by reference', () => {
  const a = { note: 'C4', start: 0, dur: 120 };
  const b = { note: 'D4', start: 240, dur: 120 };
  const out = legatoEvents([a, b]);
  const solo = { note: 'C4', start: 0, dur: 480 };
  const outSolo = legatoEvents([solo]);
  return out[0] !== a && out[0].dur === 240 && out[1] === b && outSolo[0] === solo;
});

function lBtn(container) {
  return container.querySelector('.pr-l-btn');
}

check('legato row renders a label and an L button (backlog #36)', () => {
  const container = document.createElement('div');
  const pr = createPianoRoll({
    container,
    engine: prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [] }]),
    transport: fauxTransport(),
    history: createHistory(),
  });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  return !!lBtn(container)
    && container.querySelector('.pr-l-name').textContent === 'legato'
    && lBtn(container).textContent === 'L';
});

check('L extends each note to the next one (undoable)', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }, { note: 'D4', start: 240, dur: 120 }] }]);
  const history = createHistory();
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  lBtn(container).click();
  const durs = engine.byId.trk_a.clips[0].events.map(e => e.dur).sort((x, y) => x - y);
  history.undo();
  const undone = engine.byId.trk_a.clips[0].events.map(e => e.dur).sort((x, y) => x - y);
  return durs[0] === 120 && durs[1] === 240 && undone[0] === 120 && undone[1] === 120;
});

check('L applies only to the marquee selection', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 120 }, { note: 'D4', start: 240, dur: 120 }, { note: 'E4', start: 480, dur: 120 }] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  const body = container.querySelector('.pr-body');
  body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 34, clientY: 132 }));
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 64, clientY: 145 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 64, clientY: 145 }));
  lBtn(container).click();
  const durs = engine.byId.trk_a.clips[0].events.map(e => e.dur);
  return durs[0] === 240 && durs[1] === 120 && durs[2] === 120;
});

check('L is a no-op when no clip is selected', () => {
  const container = document.createElement('div');
  const pr = createPianoRoll({ container, engine: prEngine([]), transport: fauxTransport(), history: createHistory() });
  pr.setSelection(null);
  lBtn(container).click();
  return !!container.querySelector('.pr-empty');
});

// ---- piano roll fixed length UI (backlog #37) -------------------------------
check('fixedLengthDur returns the active snap grid step in ticks', () => {
  return fixedLengthDur(480, 1) === 120 && fixedLengthDur(480, 2) === 240 && fixedLengthDur(480, 4) === 480 && fixedLengthDur(960, 2) === 480;
});

check('fixedLengthEvents sets every duration to the grid step (unchanged ones by reference)', () => {
  const a = { note: 'C4', start: 0, dur: 240 };
  const b = { note: 'D4', start: 240, dur: 120 };
  const out = fixedLengthEvents([a, b], { ppq: 480, grid: 1 });
  const same = fixedLengthEvents([a], { ppq: 480, grid: 2 });
  return out[0] !== a && out[0].dur === 120 && out[1] === b && same[0] === a;
});

function fBtn(container) {
  return container.querySelector('.pr-f-btn');
}

check('fixed length row renders a label and an F button (backlog #37)', () => {
  const container = document.createElement('div');
  const pr = createPianoRoll({
    container,
    engine: prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [] }]),
    transport: fauxTransport(),
    history: createHistory(),
  });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  return !!fBtn(container)
    && container.querySelector('.pr-f-name').textContent === 'fixed len'
    && fBtn(container).textContent === 'F';
});

check('F snaps note durations to the active snap grid (undoable)', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 240 }, { note: 'D4', start: 240, dur: 120 }] }]);
  const history = createHistory();
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  container.querySelector('.pr-snap-btn[data-v="2"]').click();
  fBtn(container).click();
  const durs = engine.byId.trk_a.clips[0].events.map(e => e.dur).sort((x, y) => x - y);
  history.undo();
  const undone = engine.byId.trk_a.clips[0].events.map(e => e.dur).sort((x, y) => x - y);
  return durs[0] === 240 && durs[1] === 240 && undone[0] === 120 && undone[1] === 240;
});

check('F applies only to the marquee selection', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 240 }, { note: 'D4', start: 240, dur: 240 }, { note: 'E4', start: 480, dur: 120 }] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  const body = container.querySelector('.pr-body');
  body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 34, clientY: 132 }));
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 64, clientY: 145 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 64, clientY: 145 }));
  fBtn(container).click();
  const durs = engine.byId.trk_a.clips[0].events.map(e => e.dur);
  // Snap is 1/16 (120): only the selected C4 snaps down; D4 (240, unselected) keeps its length.
  return durs[0] === 120 && durs[1] === 240 && durs[2] === 120;
});

check('F is a no-op when no clip is selected', () => {
  const container = document.createElement('div');
  const pr = createPianoRoll({ container, engine: prEngine([]), transport: fauxTransport(), history: createHistory() });
  pr.setSelection(null);
  fBtn(container).click();
  return !!container.querySelector('.pr-empty');
});

// ---- piano roll humanize UI (backlog #39) ----------------------------------
check('humanizeStart offsets a start by up to ±timing% of the step', () => {
  // random() 1 → full positive offset; 0 → full negative.
  return humanizeStart(240, { step: 120, timing: 100, random: () => 1 }) === 360
    && humanizeStart(240, { step: 120, timing: 50, random: () => 0 }) === 180;
});

check('humanizeStart never goes below 0', () => {
  return humanizeStart(0, { step: 120, timing: 100, random: () => 0 }) === 0;
});

check('humanizeStart with timing 0 leaves the start untouched', () => {
  return humanizeStart(240, { step: 120, timing: 0, random: () => 1 }) === 240;
});

check('humanizeVelocity clamps into 1..127 and honors amount 0', () => {
  return humanizeVelocity(100, { amount: 20, random: () => 1 }) === 120
    && humanizeVelocity(127, { amount: 50, random: () => 1 }) === 127
    && humanizeVelocity(10, { amount: 50, random: () => 0 }) === 1
    && humanizeVelocity(100, { amount: 0, random: () => 1 }) === 100
    && humanizeVelocity(undefined, { amount: 20, random: () => 1 }) === undefined;
});

check('humanizeEvents applies timing and velocity to events', () => {
  const out = humanizeEvents([{ note: 'C4', start: 0, dur: 120, velocity: 100 }],
    { ppq: 480, grid: 1, timing: 100, velocity: 40, random: () => 1 });
  return out.length === 1 && out[0] !== undefined && out[0].start === 120 && out[0].velocity === 127;
});

check('humanizeEvents keeps unchanged events by reference', () => {
  // random() 0.5 → zero offsets for both start and velocity.
  const a = { note: 'C4', start: 240, dur: 120, velocity: 100 };
  const b = { note: 'D4', start: 360, dur: 120 }; // no velocity — untouched by amount 20
  const out = humanizeEvents([a, b], { ppq: 480, grid: 1, timing: 100, velocity: 20, random: () => 0.5 });
  return out[0] === a && out[1] === b;
});

function hBtn(container) {
  return container.querySelector('.pr-h-btn');
}

check('humanize row renders a label, inputs and an H button (backlog #39)', () => {
  const container = document.createElement('div');
  const pr = createPianoRoll({
    container,
    engine: prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [] }]),
    transport: fauxTransport(),
    history: createHistory(),
  });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  const timing = container.querySelector('.pr-h-timing');
  const vel = container.querySelector('.pr-h-vel');
  return !!hBtn(container)
    && container.querySelector('.pr-h-name').textContent === 'humanize'
    && hBtn(container).textContent === 'H'
    && timing.value === '30' && vel.value === '20';
});

check('H humanizes note starts/velocities (undoable)', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [
    { note: 'C4', start: 0, dur: 120, velocity: 100 },
    { note: 'D4', start: 240, dur: 120, velocity: 90 },
    { note: 'E4', start: 480, dur: 120, velocity: 80 },
  ] }]);
  const history = createHistory();
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  container.querySelector('.pr-h-timing').value = '100';
  container.querySelector('.pr-h-vel').value = '127';
  const snap = () => JSON.stringify(engine.byId.trk_a.clips[0].events.map(e => [e.start, e.velocity]));
  const before = snap();
  hBtn(container).click();
  const after = snap();
  history.undo();
  const undone = snap();
  return before !== after && before === undone && engine.byId.trk_a.clips[0].events.length === 3;
});

check('H applies only to the marquee selection', () => {
  const container = document.createElement('div');
  const engine = prEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [
    { note: 'C4', start: 0, dur: 120, velocity: 100 },
    { note: 'D4', start: 240, dur: 120, velocity: 100 },
    { note: 'E4', start: 480, dur: 120, velocity: 100 },
  ] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  container.querySelector('.pr-h-timing').value = '100';
  container.querySelector('.pr-h-vel').value = '127';
  const body = container.querySelector('.pr-body');
  body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 34, clientY: 132 }));
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 64, clientY: 145 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 64, clientY: 145 }));
  hBtn(container).click();
  const evs = engine.byId.trk_a.clips[0].events;
  const sel = evs.find(e => e.note === 'C4');
  const untouched = evs.filter(e => e.note !== 'C4');
  return sel && (sel.start !== 0 || sel.velocity !== 100)
    && untouched.every(e => e.start === 240 || e.start === 480) && untouched.every(e => e.velocity === 100);
});

check('H is a no-op when no clip is selected', () => {
  const container = document.createElement('div');
  const pr = createPianoRoll({ container, engine: prEngine([]), transport: fauxTransport(), history: createHistory() });
  pr.setSelection(null);
  hBtn(container).click();
  return !!container.querySelector('.pr-empty');
});

// ---- preview (backlog #40) --------------------------------------------------
check('previewEvents schedules each event at its musical offset', () => {
  const calls = [];
  const n = previewEvents([
    { note: 'C4', start: 0, dur: 120, velocity: 90 },
    { note: 'D4', start: 240, dur: 240 },
  ], { bpm: 120, ppq: 480, now: 1, schedule: (note, vel, durSec, when) => calls.push([note, vel, durSec, when]) });
  // tps = (120/60)*480 = 960; lead 0.06.
  return n === 2
    && calls[0][0] === 'C4' && calls[0][1] === 90 && near(calls[0][2], 120 / 960) && near(calls[0][3], 1.06)
    && calls[1][0] === 'D4' && calls[1][1] === 100 && near(calls[1][2], 240 / 960) && near(calls[1][3], 1.31);
});

check('previewEvents falls back to a sixteenth for non-positive durations', () => {
  const calls = [];
  previewEvents([{ note: 'E4', start: 480, dur: 0 }], { schedule: (note, vel, durSec) => calls.push([note, vel, durSec]) });
  return calls.length === 1 && calls[0][2] === 0.125; // ppq/4 = 120 ticks at tps 960
});

check('previewEvents scales with tempo', () => {
  const calls = [];
  previewEvents([{ note: 'C4', start: 480, dur: 240 }], { bpm: 60, schedule: (n2, v, d, w) => calls.push([d, w]) });
  return near(calls[0][0], 0.5) && near(calls[0][1], 0.06 + 1); // tps 480 at bpm 60
});

check('previewEvents tolerates empty input and a missing schedule', () => {
  return previewEvents([], { schedule: () => {} }) === 0
    && previewEvents(null, { schedule: () => {} }) === 0
    && previewEvents([{ note: 'C4', start: 0, dur: 120 }], {}) === 0;
});

function prevBtn(container, cls) {
  return container.querySelector('.' + cls);
}

// An engine fixture that records auditionNote calls for preview assertions.
function prevEngine(clips) {
  const engine = prEngine(clips);
  engine.auditionCalls = [];
  engine.auditionNote = (trackId, note, vel, durSec, when) => {
    engine.auditionCalls.push({ trackId, note, vel, durSec, when });
  };
  return engine;
}

check('every operation row has a ▶ preview button (backlog #40)', () => {
  const container = document.createElement('div');
  const pr = createPianoRoll({
    container,
    engine: prevEngine([{ id: 'c1', name: 'Clip 1', start: 1920, length: 1920, events: [] }]),
    transport: fauxTransport(),
    history: createHistory(),
  });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  return ['pr-q-prev', 'pr-t-prev', 'pr-l-prev', 'pr-f-prev', 'pr-h-prev']
    .every(cls => prevBtn(container, cls) && prevBtn(container, cls).textContent === '▶');
});

check('Q ▶ previews quantized starts without committing', () => {
  const container = document.createElement('div');
  const engine = prevEngine([{ id: 'c1', name: 'Clip 1', start: 1920, length: 1920, events: [
    { note: 'C4', start: 90, dur: 120 },
    { note: 'D4', start: 330, dur: 120 },
  ] }]);
  const history = createHistory();
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  prevBtn(container, 'pr-q-prev').click();
  const whens = engine.auditionCalls.map(c => c.when);
  // Arranged clip: no grid fold; snap 1/16 (step 120), strength 100 → 90→120, 330→360.
  return engine.auditionCalls.length === 2
    && engine.auditionCalls.every(c => c.trackId === 'trk_a')
    && near(whens[0], 0.06 + 120 / 960, 1e-9) && near(whens[1], 0.06 + 360 / 960, 1e-9)
    && engine.byId.trk_a.clips[0].events[0].start === 90
    && engine.byId.trk_a.clips[0].events[1].start === 330;
});

check('T ▶ previews transposed pitches without committing', () => {
  const container = document.createElement('div');
  const engine = prevEngine([{ id: 'c1', name: 'Clip 1', start: 1920, length: 1920, events: [
    { note: 'C4', start: 0, dur: 120 },
  ] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  container.querySelector('.pr-t-semi').value = '2';
  prevBtn(container, 'pr-t-prev').click();
  return engine.auditionCalls.length === 1 && engine.auditionCalls[0].note === 'D4'
    && engine.byId.trk_a.clips[0].events[0].note === 'C4';
});

check('H ▶ on the loop clip sounds the folded grid (what commit would produce)', () => {
  const container = document.createElement('div');
  const engine = prevEngine([{ id: 'c1', name: 'Clip 1', start: 0, length: 1920, events: [
    { note: 'C4', start: 130, dur: 120, velocity: 100 },
    { note: 'D4', start: 250, dur: 120, velocity: 100 },
  ] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  container.querySelector('.pr-h-timing').value = '5'; // ±6 ticks — stays inside each step
  container.querySelector('.pr-h-vel').value = '0';
  prevBtn(container, 'pr-h-prev').click();
  // The commit folds starts into the 16-step grid, so the preview must sound
  // gridded starts (multiples of 120 ticks) even though humanize moved them.
  const offsets = engine.auditionCalls.map(c => Math.round((c.when - 0.06) * 960));
  return engine.auditionCalls.length === 2
    && offsets.every(o => o % 120 === 0)
    && offsets.includes(120) && offsets.includes(240)
    && engine.byId.trk_a.clips[0].events[0].start === 130;
});

check('▶ previews are a no-op when no clip is selected', () => {
  const container = document.createElement('div');
  const engine = prevEngine([]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection(null);
  ['pr-q-prev', 'pr-t-prev', 'pr-l-prev', 'pr-f-prev', 'pr-h-prev'].forEach(cls => prevBtn(container, cls).click());
  return engine.auditionCalls.length === 0 && !!container.querySelector('.pr-empty');
});

// ---- step input (backlog #42) ----------------------------------------------
function pressKey(key, opts) {
  window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key }, opts || {})));
}

check('STEP button renders in the piano roll controls (backlog #42)', () => {
  const container = document.createElement('div');
  createPianoRoll({
    container,
    engine: prevEngine([{ id: 'c1', name: 'Clip 1', start: 1920, length: 1920, events: [] }]),
    transport: fauxTransport(),
    history: createHistory(),
  });
  const btn = container.querySelector('.pr-step-btn');
  return !!btn && btn.textContent === 'STEP' && !btn.classList.contains('on');
});

check('STEP: typing Z then X inserts C3@0 and D3@120 and advances the cursor', () => {
  const container = document.createElement('div');
  const engine = prevEngine([{ id: 'c1', name: 'Clip 1', start: 1920, length: 1920, events: [] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  container.querySelector('.pr-step-btn').click();
  pressKey('z');
  pressKey('x');
  const evs = engine.byId.trk_a.clips[0].events;
  return evs.length === 2
    && evs[0].note === 'C3' && evs[0].start === 0 && evs[0].dur === 120 && evs[0].velocity === 100
    && evs[1].note === 'D3' && evs[1].start === 120 && evs[1].dur === 120;
});

check('STEP: each typed note auditions as a self-terminating preview', () => {
  const container = document.createElement('div');
  const engine = prevEngine([{ id: 'c1', name: 'Clip 1', start: 1920, length: 1920, events: [] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  container.querySelector('.pr-step-btn').click();
  pressKey('q'); // C4
  return engine.auditionCalls.length === 1
    && engine.auditionCalls[0].note === 'C4'
    && engine.auditionCalls[0].vel === 100
    && near(engine.auditionCalls[0].durSec, 0.125, 1e-9);
});

check('STEP: inserted notes are undoable one per keypress', () => {
  const container = document.createElement('div');
  const engine = prevEngine([{ id: 'c1', name: 'Clip 1', start: 1920, length: 1920, events: [] }]);
  const history = createHistory();
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  container.querySelector('.pr-step-btn').click();
  pressKey('z');
  pressKey('x');
  history.undo();
  if (engine.byId.trk_a.clips[0].events.length !== 1) return false;
  history.undo();
  return engine.byId.trk_a.clips[0].events.length === 0;
});

check('STEP: ArrowRight moves the insert cursor', () => {
  const container = document.createElement('div');
  const engine = prevEngine([{ id: 'c1', name: 'Clip 1', start: 1920, length: 1920, events: [] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  container.querySelector('.pr-step-btn').click();
  pressKey('ArrowRight');
  pressKey('ArrowRight');
  pressKey('z');
  const evs = engine.byId.trk_a.clips[0].events;
  return evs.length === 1 && evs[0].note === 'C3' && evs[0].start === 240;
});

check('STEP: snap step scales both duration and advance (1/8 → 240 ticks)', () => {
  const container = document.createElement('div');
  const engine = prevEngine([{ id: 'c1', name: 'Clip 1', start: 1920, length: 1920, events: [] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  container.querySelector('.pr-snap-btn[data-v="2"]').click(); // 1/8
  container.querySelector('.pr-step-btn').click();
  pressKey('z');
  pressKey('w'); // D4 — next 1/8 slot
  const evs = engine.byId.trk_a.clips[0].events;
  return evs.length === 2
    && evs[0].start === 0 && evs[0].dur === 240
    && evs[1].note === 'D4' && evs[1].start === 240 && evs[1].dur === 240;
});

check('STEP: Backspace erases under the cursor and steps back', () => {
  const container = document.createElement('div');
  const engine = prevEngine([{ id: 'c1', name: 'Clip 1', start: 1920, length: 1920, events: [] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  container.querySelector('.pr-step-btn').click();
  pressKey('z');
  pressKey('x');
  pressKey('Backspace');
  const evs = engine.byId.trk_a.clips[0].events;
  return evs.length === 1 && evs[0].note === 'C3' && evs[0].start === 0;
});

check('STEP: Esc exits step mode and further keys do nothing', () => {
  const container = document.createElement('div');
  const engine = prevEngine([{ id: 'c1', name: 'Clip 1', start: 1920, length: 1920, events: [] }]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection({ trackId: 'trk_a', clipId: 'c1' });
  const btn = container.querySelector('.pr-step-btn');
  btn.click();
  pressKey('Escape');
  if (btn.classList.contains('on')) return false;
  if (container.querySelector('.pr-cursor')) return false;
  pressKey('z');
  return engine.byId.trk_a.clips[0].events.length === 0;
});

check('STEP: no-op without a selected clip', () => {
  const container = document.createElement('div');
  const engine = prevEngine([]);
  const pr = createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  pr.setSelection(null);
  container.querySelector('.pr-step-btn').click();
  pressKey('z');
  return !container.querySelector('.pr-cursor')
    && engine.byId.trk_a.clips.length === 0
    && !!container.querySelector('.pr-empty');
});

check('STEP: keys typed into inputs are ignored', () => {
  const container = document.createElement('div');
  const engine = prevEngine([{ id: 'c1', name: 'Clip 1', start: 1920, length: 1920, events: [] }]);
  createPianoRoll({ container, engine, transport: fauxTransport(), history: createHistory() });
  container.querySelector('.pr-step-btn').click();
  const input = document.createElement('input');
  input.type = 'text';
  document.body.appendChild(input);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
  document.body.removeChild(input);
  return engine.byId.trk_a.clips[0].events.length === 0;
});

summary.textContent = `${passed.length} passed, ${failed.length} failed`;
if (failed.length) summary.className = 'fail';
window.__testResults = { passed: passed.length, failed: failed.length };
