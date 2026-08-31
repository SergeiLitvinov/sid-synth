// Piano-roll note editor (backlog #25/#26/#27/#29/#30/#31): shows the selected
// clip's events as bars on a pitch/step grid. Clicking an empty cell adds a
// one-sixteenth note, dragging a bar moves it (snapped to steps and pitch),
// trimming its edges resizes the start/duration, and clicking a note removes
// it — all through the command history so undo/redo work. Below the grid, a
// velocity lane (one bar per note, bottom-aligned to velocity/127) edits each
// note's velocity by dragging. Backlog #29: drag on the empty grid to marquee
// box-select notes, drag a selected bar to move the whole selection together,
// and Delete/Backspace removes every selected note as one undoable command.
// Backlog #30: pressing a bar auditions the note through the track voice (and
// re-auditions the pitch while dragging); drawing a note plays a short
// self-terminating preview. Backlog #31: `−`/`+` buttons and Ctrl+wheel zoom
// the grid (px per step/row scale together), and a snap selector quantizes
// draw/move/resize to 1/16, 1/8, 1/4 or off (free, sub-sixteenth ticks).
// Backlog #39: an H button nudges note starts and velocities with random
// offsets for a performed feel. Backlog #40: every operation row has a ▶
// button that auditions the transformation as a one-pass phrase through the
// track voice — before anything is committed.
// Reads clips from the engine and reacts to the history.

import { pianoRows, pianoSteps, layoutPianoNotes, layoutVelocityBars, noteToMidi, midiToNote, DEFAULT_LOW_MIDI, DEFAULT_HIGH_MIDI } from './pianoRollLayout.js';
import { quantizeStart } from './quantize.js';
import { transposeEvents } from './transpose.js';
import { duplicateEvents } from './duplicate.js';
import { legatoEvents } from './legato.js';
import { fixedLengthEvents } from './fixedLength.js';
import { humanizeEvents } from './humanize.js';
import { previewEvents } from './preview.js';
import { clipEventsToGrid, gridToClipEvents } from '../project/clipEvents.js';
import { editClipEventsCommand } from '../project/trackCommands.js';

const CELL_W = 18;
const CELL_H = 12;
const PITCH_W = 34;
const VEL_H = 40;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

export function createPianoRoll({ container, engine, transport, history }) {
  const el = container;
  el.classList.add('piano-roll');

  const header = document.createElement('div');
  header.className = 'pr-header';
  const title = document.createElement('span');
  title.className = 'pr-title';
  title.textContent = 'PIANO ROLL';

  // Zoom and snap controls (backlog #31): zoom scales the step/pitch cells
  // together (18px × 12px at 100%), snap quantizes the step grid.
  const controls = document.createElement('div');
  controls.className = 'pr-controls';
  const zoomOut = document.createElement('button');
  zoomOut.className = 'pr-zoom-btn';
  zoomOut.textContent = '−';
  zoomOut.title = 'Zoom out';
  zoomOut.addEventListener('click', () => zoomBy(1 / 1.25));
  const zoomLabel = document.createElement('span');
  zoomLabel.className = 'pr-zoom-label';
  zoomLabel.textContent = CELL_W + ' px/step';
  const zoomIn = document.createElement('button');
  zoomIn.className = 'pr-zoom-btn';
  zoomIn.textContent = '+';
  zoomIn.title = 'Zoom in';
  zoomIn.addEventListener('click', () => zoomBy(1.25));
  const snapName = document.createElement('span');
  snapName.className = 'pr-snap-name';
  snapName.textContent = 'snap';
  const snapBtns = [];
  [[1, '1/16'], [2, '1/8'], [4, '1/4'], [0, 'off']].forEach(([v, txt]) => {
    const b = document.createElement('button');
    b.className = 'pr-snap-btn';
    b.dataset.v = String(v);
    b.textContent = txt;
    b.title = 'Snap ' + txt;
    b.addEventListener('click', () => setSnap(v));
    snapBtns.push(b);
    controls.append(b);
  });
  controls.append(zoomOut, zoomLabel, zoomIn, snapName);

  // Step input (backlog #42): when armed, the computer keyboard types notes at
  // the cursor column instead of doing anything else.
  const stepBtn = document.createElement('button');
  stepBtn.className = 'pr-step-btn';
  stepBtn.textContent = 'STEP';
  stepBtn.title = 'Step input: Z S X D C V G B H N J M = C3..B3, Q 2 W 3 E R 5 T 6 Y 7 U = C4..B4; each note advances the cursor by the snap step; ←/→ move the cursor, Backspace steps back and erases, Esc exits';
  stepBtn.addEventListener('click', () => setStepMode(!stepMode));
  controls.append(stepBtn);

  // Drum/step editor mode (backlog #175): toggles between piano roll and
  // drum-grid view. The drum grid shows a 16-step × 12-pitch matrix where
  // each cell is a toggleable note — backed by the same clip events model.
  let drumMode = false;
  const drumBtn = document.createElement('button');
  drumBtn.className = 'pr-step-btn';
  drumBtn.textContent = 'DRUM';
  drumBtn.title = 'Toggle drum/step editor mode: 16-step grid with drum pads (C3–B3)';
  drumBtn.addEventListener('click', () => { drumMode = !drumMode; drumBtn.classList.toggle('on', drumMode); render(); });
  controls.append(drumBtn);

  const hint = document.createElement('div');
  hint.className = 'pr-hint';
  hint.textContent = 'select a clip in the arranger — click an empty cell to add a note (auditioned), drag on the grid to box-select notes, drag a note (or a selection) to move it (its pitch auditions while you drag), drag its edges to resize, click a note to remove it, Delete removes the selection, Ctrl+D duplicates it; drag a velocity bar to set the note velocity; zoom with the −/+ buttons or Ctrl+wheel; quantize note starts with Q (strength/swing, snaps to the active grid); transpose note pitches with T (semitones, clamped to the visible range); extend each note to the next one with L (legato); set each note length to the snap grid step with F (fixed length); nudge note starts and velocities with H (humanize, random offsets); arm STEP to type notes from the keyboard at the cursor (arrows move it, Backspace steps back, Esc exits)';
  header.append(title, controls);
  el.append(header, hint);

  // Quantize controls (backlog #33): strength (0-100) and swing (0-100) inputs
  // plus a Q button that snaps note starts to the active snap grid (1/16 when
  // snap is off). Applies to the marquee selection, or every note when none is
  // selected — committed through the command history so undo/redo work.
  const qrow = document.createElement('div');
  qrow.className = 'pr-qrow';
  const qName = document.createElement('span');
  qName.className = 'pr-q-name';
  qName.textContent = 'quantize';
  const qStrength = document.createElement('input');
  qStrength.type = 'number';
  qStrength.className = 'pr-q-strength';
  qStrength.min = '0';
  qStrength.max = '100';
  qStrength.step = '5';
  qStrength.value = '100';
  qStrength.title = 'Quantize strength (0-100%)';
  const qSwing = document.createElement('input');
  qSwing.type = 'number';
  qSwing.className = 'pr-q-swing';
  qSwing.min = '0';
  qSwing.max = '100';
  qSwing.step = '5';
  qSwing.value = '0';
  qSwing.title = 'Swing (0-100%: delays every second grid step)';
  const qApply = document.createElement('button');
  qApply.className = 'pr-q-btn';
  qApply.textContent = 'Q';
  qApply.title = 'Quantize note starts to the snap grid (selected notes, or all when none selected)';
  qApply.addEventListener('click', onQuantize);
  const qPrev = document.createElement('button');
  qPrev.className = 'pr-q-prev';
  qPrev.textContent = '▶';
  qPrev.title = 'Preview the quantize result (audition only — nothing is committed)';
  qPrev.addEventListener('click', onQuantizePreview);
  qrow.append(qName, qStrength, qSwing, qApply, qPrev);
  el.append(qrow);

  // Transpose controls (backlog #34): a semitone interval input and a T button
  // that shifts note pitches by that interval (clamped into the editor's pitch
  // range C3..B4). Applies to the marquee selection, or every note when none
  // is selected — committed through the command history so undo/redo work.
  const trow = document.createElement('div');
  trow.className = 'pr-trow';
  const tName = document.createElement('span');
  tName.className = 'pr-t-name';
  tName.textContent = 'transpose';
  const tSemi = document.createElement('input');
  tSemi.type = 'number';
  tSemi.className = 'pr-t-semi';
  tSemi.min = '-24';
  tSemi.max = '24';
  tSemi.step = '1';
  tSemi.value = '1';
  tSemi.title = 'Transpose interval in semitones (−24..24)';
  const tApply = document.createElement('button');
  tApply.className = 'pr-t-btn';
  tApply.textContent = 'T';
  tApply.title = 'Transpose note pitches by the interval (selected notes, or all when none selected)';
  tApply.addEventListener('click', onTranspose);
  const tPrev = document.createElement('button');
  tPrev.className = 'pr-t-prev';
  tPrev.textContent = '▶';
  tPrev.title = 'Preview the transposition (audition only — nothing is committed)';
  tPrev.addEventListener('click', onTransposePreview);
  trow.append(tName, tSemi, tApply, tPrev);
  el.append(trow);

  // Legato control (backlog #36): an L button that extends each target note so
  // it lasts until the start of the next note (monophonic legato — the
  // chronologically next event with a strictly greater start). Notes are never
  // shortened: one that already reaches its successor keeps its duration, and
  // the last note has no successor. Applies to the marquee selection, or every
  // note when none is selected — committed through the command history so
  // undo/redo work.
  const lrow = document.createElement('div');
  lrow.className = 'pr-lrow';
  const lName = document.createElement('span');
  lName.className = 'pr-l-name';
  lName.textContent = 'legato';
  const lApply = document.createElement('button');
  lApply.className = 'pr-l-btn';
  lApply.textContent = 'L';
  lApply.title = 'Extend each note to the start of the next one (selected notes, or all when none selected)';
  lApply.addEventListener('click', onLegato);
  const lPrev = document.createElement('button');
  lPrev.className = 'pr-l-prev';
  lPrev.textContent = '▶';
  lPrev.title = 'Preview the legato result (audition only — nothing is committed)';
  lPrev.addEventListener('click', onLegatoPreview);
  lrow.append(lName, lApply, lPrev);
  el.append(lrow);

  // Fixed length control (backlog #37): an F button that sets every target
  // note's duration to the active snap grid step (1/16 when snap is off) —
  // turning a mixed-length phrase into uniform grid-length notes. Applies to
  // the marquee selection, or every note when none is selected — committed
  // through the command history so undo/redo work.
  const frow = document.createElement('div');
  frow.className = 'pr-frow';
  const fName = document.createElement('span');
  fName.className = 'pr-f-name';
  fName.textContent = 'fixed len';
  const fApply = document.createElement('button');
  fApply.className = 'pr-f-btn';
  fApply.textContent = 'F';
  fApply.title = 'Set every note\'s length to the snap grid step (selected notes, or all when none selected)';
  fApply.addEventListener('click', onFixedLength);
  const fPrev = document.createElement('button');
  fPrev.className = 'pr-f-prev';
  fPrev.textContent = '▶';
  fPrev.title = 'Preview the fixed lengths (audition only — nothing is committed)';
  fPrev.addEventListener('click', onFixedLengthPreview);
  frow.append(fName, fApply, fPrev);
  el.append(frow);

  // Humanize controls (backlog #39): timing (0-100% of the snap step) and
  // velocity (±N, clamped to 1..127) inputs plus an H button that nudges note
  // starts and velocities with random offsets for a performed feel. Applies to
  // the marquee selection, or every note when none is selected — committed
  // through the command history so undo/redo work. On a loop clip the start
  // offsets fold into the 16-step grid on commit (see #31/#33), so timing
  // humanize is only observable on arranged clips; velocity survives both.
  const hrow = document.createElement('div');
  hrow.className = 'pr-hrow';
  const hName = document.createElement('span');
  hName.className = 'pr-h-name';
  hName.textContent = 'humanize';
  const hTiming = document.createElement('input');
  hTiming.type = 'number';
  hTiming.className = 'pr-h-timing';
  hTiming.min = '0';
  hTiming.max = '100';
  hTiming.step = '5';
  hTiming.value = '30';
  hTiming.title = 'Humanize timing (0-100% of the snap step)';
  const hVel = document.createElement('input');
  hVel.type = 'number';
  hVel.className = 'pr-h-vel';
  hVel.min = '0';
  hVel.max = '127';
  hVel.step = '1';
  hVel.value = '20';
  hVel.title = 'Humanize velocity (±, clamped to 1-127)';
  const hApply = document.createElement('button');
  hApply.className = 'pr-h-btn';
  hApply.textContent = 'H';
  hApply.title = 'Humanize note starts and velocities with random offsets (selected notes, or all when none selected)';
  hApply.addEventListener('click', onHumanize);
  const hPrev = document.createElement('button');
  hPrev.className = 'pr-h-prev';
  hPrev.textContent = '▶';
  hPrev.title = 'Preview one humanize pass (audition only — nothing is committed)';
  hPrev.addEventListener('click', onHumanizePreview);
  hrow.append(hName, hTiming, hVel, hApply, hPrev);
  el.append(hrow);

  const gridWrap = document.createElement('div');
  gridWrap.className = 'pr-wrap';
  el.append(gridWrap);

  let sel = null; // { trackId, clipId }
  // Zoom and snap state (backlog #31). cellW/cellH are the current pixel cell
  // sizes (a single zoom factor scales them together); snapDiv is the grid
  // quantization in sixteenth columns — 1 (1/16), 2 (1/8), 4 (1/4) or 0 (off,
  // sub-sixteenth ticks).
  let zoom = 1;
  let snapDiv = 1;
  let cellW = CELL_W;
  let cellH = CELL_H;

  function applyZoom() {
    cellW = Math.round(CELL_W * zoom);
    cellH = Math.round(CELL_H * zoom);
    zoomLabel.textContent = cellW + ' px/step';
    render();
  }

  function zoomBy(f) {
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * f));
    applyZoom();
  }

  function setSnap(v) {
    snapDiv = v;
    snapBtns.forEach(b => b.classList.toggle('active', Number(b.dataset.v) === v));
    render();
  }

  // Quantize a step column to the active snap grid (identity when snap is off).
  function snapCol(col) {
    if (snapDiv <= 0) return col;
    return Math.round(col / snapDiv) * snapDiv;
  }

  // Clamp a number input value into [min, max], falling back to `dflt` when
  // it is missing, NaN or out of range.
  function clampNum(v, dflt, min, max) {
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(min, Math.min(max, n));
  }

  // Backlog #33: quantize note starts toward the active snap grid with the
  // strength/swing from the Q row. Applies to the marquee selection when there
  // is one, otherwise to every note in the clip. Runs through the command
  // history (commitCtx of the current render) so undo/redo work.
  function onQuantize() {
    if (!commitCtx || !commitCtx.events || !commitCtx.events.length) return;
    const strength = clampNum(qStrength.value, 100, 0, 100);
    const swing = clampNum(qSwing.value, 0, 0, 100);
    const grid = snapDiv > 0 ? snapDiv : 1;
    const ppq = transport.ppq || 480;
    const targets = selected.size
      ? commitCtx.events.filter(ev => selected.has(ev))
      : commitCtx.events;
    if (!targets.length) return;
    commitCtx.commitEvents(events => {
      targets.forEach(ev => {
        const i = events.indexOf(ev);
        if (i < 0) return;
        const cur = events[i];
        const start = quantizeStart(cur.start || 0, { ppq, grid, strength, swing });
        if (start !== (cur.start || 0)) events[i] = { ...cur, start };
      });
      events.sort((a, b) => (a.start || 0) - (b.start || 0));
    });
  }

  // Backlog #34: shift note pitches by the semitone interval from the T row,
  // clamped into the editor's pitch range. Applies to the marquee selection
  // when there is one, otherwise to every note in the clip. Committed through
  // the command history (commitCtx of the current render) so undo/redo work.
  function onTranspose() {
    if (!commitCtx || !commitCtx.events || !commitCtx.events.length) return;
    const semi = clampNum(tSemi.value, 1, -24, 24);
    if (!semi) return;
    const targets = selected.size
      ? commitCtx.events.filter(ev => selected.has(ev))
      : commitCtx.events;
    if (!targets.length) return;
    commitCtx.commitEvents(events => {
      targets.forEach(ev => {
        const i = events.indexOf(ev);
        if (i < 0) return;
        const shifted = transposeEvents([events[i]], semi)[0];
        if (shifted !== events[i]) events[i] = shifted;
      });
    });
  }

  // Backlog #36: extend each target note so it lasts until the start of the
  // next note (monophonic legato). Applies to the marquee selection when there
  // is one, otherwise to every note in the clip; a note's successor is found
  // across the whole clip, not just the selection. Never shortens a note that
  // already reaches its successor. Committed through the command history
  // (commitCtx of the current render) so undo/redo work.
  function onLegato() {
    if (!commitCtx || !commitCtx.events || !commitCtx.events.length) return;
    const targets = selected.size
      ? commitCtx.events.filter(ev => selected.has(ev))
      : commitCtx.events;
    if (!targets.length) return;
    commitCtx.commitEvents(events => {
      const changed = legatoEvents(events);
      changed.forEach((r, i) => {
        if (r !== events[i] && targets.indexOf(events[i]) >= 0) events[i] = r;
      });
      events.sort((a, b) => (a.start || 0) - (b.start || 0));
    });
  }

  // Backlog #37: set every target note's duration to the active snap grid step
  // (1/16 when snap is off). Applies to the marquee selection when there is
  // one, otherwise to every note in the clip. Committed through the command
  // history (commitCtx of the current render) so undo/redo work.
  function onFixedLength() {
    if (!commitCtx || !commitCtx.events || !commitCtx.events.length) return;
    const grid = snapDiv > 0 ? snapDiv : 1;
    const ppq = transport.ppq || 480;
    const targets = selected.size
      ? commitCtx.events.filter(ev => selected.has(ev))
      : commitCtx.events;
    if (!targets.length) return;
    commitCtx.commitEvents(events => {
      const changed = fixedLengthEvents(events, { ppq, grid });
      changed.forEach((r, i) => {
        if (r !== events[i] && targets.indexOf(events[i]) >= 0) events[i] = r;
      });
    });
  }
  // Backlog #39: nudge every target note's start (timing, up to timing% of the
  // snap step) and velocity (up to ±velocity) with random offsets for a
  // performed feel. Applies to the marquee selection when there is one,
  // otherwise to every note in the clip. Committed through the command history
  // (commitCtx of the current render) so undo/redo work.
  function onHumanize() {
    if (!commitCtx || !commitCtx.events || !commitCtx.events.length) return;
    const timing = clampNum(hTiming.value, 30, 0, 100);
    const velAmt = clampNum(hVel.value, 20, 0, 127);
    const grid = snapDiv > 0 ? snapDiv : 1;
    const ppq = transport.ppq || 480;
    const targets = selected.size
      ? commitCtx.events.filter(ev => selected.has(ev))
      : commitCtx.events;
    if (!targets.length) return;
    commitCtx.commitEvents(events => {
      const changed = humanizeEvents(events, { ppq, grid, timing, velocity: velAmt });
      changed.forEach((r, i) => {
        if (r !== events[i] && targets.indexOf(events[i]) >= 0) events[i] = r;
      });
      events.sort((a, b) => (a.start || 0) - (b.start || 0));
    });
  }

  // ---- preview (backlog #40) ----------------------------------------------
  // Every operation row's ▶ auditions what its apply button WOULD commit: the
  // full phrase sounds once through the track voice with only the target notes
  // transformed (marquee selection when there is one, otherwise all). Nothing
  // is committed, persisted or pushed onto the history.
  function currentTargets() {
    if (!commitCtx || !commitCtx.events || !commitCtx.events.length) return [];
    return selected.size
      ? commitCtx.events.filter(ev => selected.has(ev))
      : commitCtx.events;
  }

  // Run an array-in/array-out transform over the whole phrase but keep only
  // the target notes' changes — mirroring how the apply handlers commit.
  function mergedTargets(transformAll) {
    const targets = currentTargets();
    if (!targets.length) return null;
    const changed = transformAll(commitCtx.events);
    return commitCtx.events.map((ev, i) => (targets.indexOf(ev) >= 0 ? changed[i] : ev));
  }

  function previewTransformed(transformed) {
    if (!sel || !engine.auditionNote || !transformed || !transformed.length) return;
    const ppq = transport.ppq || 480;
    // A commit on the loop clip folds starts into its 16-step grid (see
    // #31/#33); the preview must sound what the commit would produce.
    let events = transformed;
    const tracks = (engine.getTracks && engine.getTracks()) || [];
    const t = tracks.find(x => x.id === sel.trackId);
    const clip = t && (t.clips || []).find(c => c.id === sel.clipId);
    if (clip && ((t.clips || []).find(c => c.start === 0) || (t.clips || [])[0]) === clip) {
      events = gridToClipEvents(clipEventsToGrid(events, { ppq }), { ppq });
    }
    previewEvents(events, {
      bpm: engine.bpm || 120,
      ppq,
      now: (engine.ctx && engine.ctx.currentTime) || 0,
      schedule: (note, vel, durSec, when) => engine.auditionNote(sel.trackId, note, vel, durSec, when),
    });
  }

  function onQuantizePreview() {
    if (!commitCtx || !commitCtx.events || !commitCtx.events.length) return;
    const strength = clampNum(qStrength.value, 100, 0, 100);
    const swing = clampNum(qSwing.value, 0, 0, 100);
    const grid = snapDiv > 0 ? snapDiv : 1;
    const ppqLocal = transport.ppq || 480;
    previewTransformed(mergedTargets(events => events.map(ev => {
      const start = quantizeStart(ev.start || 0, { ppq: ppqLocal, grid, strength, swing });
      return start !== (ev.start || 0) ? { ...ev, start } : ev;
    })));
  }

  function onTransposePreview() {
    const semi = clampNum(tSemi.value, 1, -24, 24);
    if (!semi) return;
    previewTransformed(mergedTargets(events => events.map(ev => transposeEvents([ev], semi)[0])));
  }

  function onLegatoPreview() {
    previewTransformed(mergedTargets(events => legatoEvents(events)));
  }

  function onFixedLengthPreview() {
    const grid = snapDiv > 0 ? snapDiv : 1;
    const ppqLocal = transport.ppq || 480;
    previewTransformed(mergedTargets(events => fixedLengthEvents(events, { ppq: ppqLocal, grid })));
  }

  function onHumanizePreview() {
    const timing = clampNum(hTiming.value, 30, 0, 100);
    const velAmt = clampNum(hVel.value, 20, 0, 127);
    const grid = snapDiv > 0 ? snapDiv : 1;
    const ppqLocal = transport.ppq || 480;
    previewTransformed(mergedTargets(events => humanizeEvents(events, { ppq: ppqLocal, grid, timing, velocity: velAmt })));
  }

  // Selection state for the current render (backlog #29). Marquee box-selects
  // notes; the selection only lives until the next render/commit, so these hold
  // event refs of the current render's `clip.events`.
  let selected = new Set();
  let noteEls = new Map(); // event ref -> note element (live preview + selected style)
  let commitCtx = null;    // { commitEvents } of the current render, for the Delete key

  // Step input state (backlog #42): stepMode arms keyboard entry, stepCol is
  // the insert cursor in sixteenth columns. Reset when the selection changes.
  let stepMode = false;
  let stepCol = 0;

  // Musical-typing keymap for step input, covering the roll range C3..B4.
  const STEP_KEYS = {
    z: 'C3', s: 'C#3', x: 'D3', d: 'D#3', c: 'E3', v: 'F3',
    g: 'F#3', b: 'G3', h: 'G#3', n: 'A3', j: 'A#3', m: 'B3',
    q: 'C4', '2': 'C#4', w: 'D4', '3': 'D#4', e: 'E4', r: 'F4',
    '5': 'F#4', t: 'G4', '6': 'G#4', y: 'A4', '7': 'A#4', u: 'B4',
  };

  function setStepMode(on) {
    stepMode = on;
    if (stepBtn) stepBtn.classList.toggle('on', stepMode);
    render();
  }

  // Geometry of the selected clip for step input; null when nothing usable is
  // selected. `advance` is how many sixteenth columns one entry moves (the
  // active snap step; free snap falls back to a sixteenth).
  function stepGeom() {
    if (!sel || !commitCtx) return null;
    const ppq = transport.ppq || 480;
    const sixteenth = Math.max(1, Math.round(ppq / 4));
    const tracks = (engine.getTracks && engine.getTracks()) || [];
    const t = tracks.find(x => x.id === sel.trackId);
    const clip = t && (t.clips || []).find(c => c.id === sel.clipId);
    if (!clip) return null;
    return {
      clip,
      ppq,
      sixteenth,
      steps: Math.max(1, Math.ceil((clip.length || sixteenth) / sixteenth)),
      advance: snapDiv > 0 ? snapDiv : 1,
    };
  }

  // Insert a note at the cursor through the command history, audition it as a
  // self-terminating preview, then advance the cursor by the snap step.
  function stepInsert(noteName) {
    const g = stepGeom();
    if (!g) return false;
    const start = stepCol * g.sixteenth;
    const durTicks = g.advance * g.sixteenth;
    const durSec = durTicks / g.ppq * (60 / (engine.bpm || 120));
    commitCtx.commitEvents(events => {
      events.push({ note: noteName, start, dur: durTicks, velocity: 100 });
      events.sort((a, b) => (a.start || 0) - (b.start || 0));
    });
    if (engine.auditionNote) engine.auditionNote(sel.trackId, noteName, 100, durSec);
    stepCol = Math.min(stepCol + g.advance, g.steps - 1);
    return true;
  }

  // Step back, then erase whatever sits in that column (step-edit erase).
  function stepErase() {
    const g = stepGeom();
    if (!g) return false;
    const prev = Math.max(0, stepCol - g.advance);
    const start = prev * g.sixteenth;
    commitCtx.commitEvents(events => {
      for (let i = events.length - 1; i >= 0; i--) {
        if ((events[i].start || 0) >= start && (events[i].start || 0) < start + g.sixteenth) events.splice(i, 1);
      }
    });
    stepCol = prev;
    return true;
  }

  // Note audition (backlog #30): pressing a bar previews the note through the
  // selected clip's track voice (open note, released on pointer-up); dragging
  // re-auditions the target pitch; drawing a note on an empty cell plays a
  // short self-terminating preview. No-ops when the engine lacks the methods
  // (unit fixtures may stub them).
  let auditionNote = null; // note name currently held open

  function auditionOn(note, vel, dur) {
    if (!sel || !engine.auditionNote) return;
    if (auditionNote && auditionNote !== note) auditionOff();
    if (dur) {
      engine.auditionNote(sel.trackId, note, vel, dur);
      return;
    }
    auditionNote = note;
    engine.auditionNote(sel.trackId, note, vel);
  }

  function auditionOff() {
    if (!auditionNote || !sel) return;
    if (engine.auditionNoteOff) engine.auditionNoteOff(sel.trackId, auditionNote);
    auditionNote = null;
  }

  function applySelected() {
    noteEls.forEach((el, ref) => el.classList.toggle('selected', selected.has(ref)));
  }

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function render() {
    clearChildren(gridWrap);
    auditionOff();
    selected = new Set();
    noteEls = new Map();
    commitCtx = null;
    const tracks = (engine.getTracks && engine.getTracks()) || [];
    let clip = null;
    if (sel) {
      const t = tracks.find(x => x.id === sel.trackId);
      clip = t && (t.clips || []).find(c => c.id === sel.clipId);
    }
    if (!clip) {
      const empty = document.createElement('div');
      empty.className = 'pr-empty';
      empty.textContent = 'No clip selected — click a clip in the arranger, then draw notes here.';
      gridWrap.appendChild(empty);
      title.textContent = drumMode ? 'DRUM GRID' : 'PIANO ROLL';
      return;
    }

    // --- DRUM / STEP EDITOR MODE (backlog #175) ---
    if (drumMode) {
      title.textContent = 'DRUM GRID · ' + (clip.name || clip.id);
      const ppq = transport.ppq || 480;
      const drumPitches = ['C3','C#3','D3','D#3','E3','F3','F#3','G3','G#3','A3','A#3','B3'];
      const drumNotes = ['Kick','Snare','HiHat','HiHat Open','Clap','Tom Hi','Tom Mid','Tom Low','Rim','Cowbell','Perc Hi','Perc Low'];
      const { stepTicks, steps } = pianoSteps(clip, ppq);
      const cw = cellW;
      const ch = cellH;
      const pitchW = PITCH_W + 20;
      const gridW = steps * cw;
      const gridH = drumPitches.length * ch;

      // Step numbers
      const stepHead = document.createElement('div');
      stepHead.className = 'pr-steps';
      stepHead.style.width = (pitchW + gridW) + 'px';
      for (let ci = 0; ci < steps; ci++) {
        const s = document.createElement('span');
        s.className = 'pr-step';
        s.textContent = ci + 1;
        s.style.left = (pitchW + ci * cw) + 'px';
        stepHead.appendChild(s);
      }

      const body = document.createElement('div');
      body.className = 'pr-body';
      body.style.width = (pitchW + gridW) + 'px';
      body.style.height = gridH + 'px';

      // Build event lookup: stepIndex -> Set of pitch indices
      const events = clip.events || [];
      const stepSet = new Map(); // stepIdx -> Set of pitchIdx
      drumPitches.forEach((_, pi) => {
        for (let si = 0; si < steps; si++) stepSet.set(si + '_' + pi, false);
      });
      events.forEach(ev => {
        const si = Math.round((ev.start || 0) / stepTicks);
        const pi = drumPitches.indexOf(ev.note);
        if (si >= 0 && si < steps && pi >= 0) stepSet.set(si + '_' + pi, true);
      });

      // Commit function for drum cell toggles (must be defined before cells)
      function drumCommitEvents(mutate) {
        const evts = (clip.events || []).slice();
        mutate(evts);
        if (history && history.execute) {
          history.execute(editClipEventsCommand(engine, sel.trackId, clip.id, evts));
        } else {
          engine.setClipEvents(sel.trackId, clip.id, evts);
          render();
        }
      }

      // Render pitch labels + drum pad cells
      drumPitches.forEach((note, ri) => {
        const lab = document.createElement('div');
        lab.className = 'pr-pitch drum-pad';
        lab.textContent = drumNotes[ri] || note;
        lab.title = note;
        lab.style.top = (ri * ch) + 'px';
        body.appendChild(lab);

        for (let ci = 0; ci < steps; ci++) {
          const cell = document.createElement('div');
          cell.className = 'pr-cell drum-cell';
          const has = stepSet.get(ci + '_' + ri);
          if (has) cell.classList.add('active');
          cell.style.left = (pitchW + ci * cw) + 'px';
          cell.style.top = (ri * ch) + 'px';
          cell.title = note + ' step ' + (ci + 1);
          cell.addEventListener('pointerdown', () => {
            const noteName = drumPitches[ri];
            const start = ci * stepTicks;
            drumCommitEvents(evts => {
              const existing = evts.findIndex(e => e.note === noteName && Math.abs((e.start || 0) - start) < 1);
              if (existing >= 0) evts.splice(existing, 1);
              else {
                evts.push({ note: noteName, start, dur: stepTicks, velocity: 100 });
                evts.sort((a, b) => (a.start || 0) - (b.start || 0));
              }
            });
          });
          body.appendChild(cell);
        }
      });

      commitCtx = { commitEvents: drumCommitEvents, events: clip.events || [] };

      gridWrap.append(stepHead, body);
      return;
    }
    // --- END DRUM MODE ---

    const ppq = transport.ppq || 480;
    const rows = pianoRows(DEFAULT_LOW_MIDI, DEFAULT_HIGH_MIDI);
    const { stepTicks, steps } = pianoSteps(clip, ppq);
    const gridW = steps * cellW;
    const gridH = rows.length * cellH;

    // Step numbers along the top.
    const stepHead = document.createElement('div');
    stepHead.className = 'pr-steps';
    stepHead.style.width = (PITCH_W + gridW) + 'px';
    for (let ci = 0; ci < steps; ci++) {
      const s = document.createElement('span');
      s.className = 'pr-step';
      s.textContent = ci + 1;
      s.style.left = (PITCH_W + ci * cellW) + 'px';
      stepHead.appendChild(s);
    }

    // Body: pitch labels on the left, cells + note bars overlaid.
    const body = document.createElement('div');
    body.className = 'pr-body';
    body.style.width = (PITCH_W + gridW) + 'px';
    body.style.height = gridH + 'px';

    rows.forEach((r, ri) => {
      const lab = document.createElement('div');
      lab.className = 'pr-pitch' + (r.black ? ' black' : '');
      lab.textContent = r.note;
      lab.style.top = (ri * cellH) + 'px';
      body.appendChild(lab);
      for (let ci = 0; ci < steps; ci++) {
        const cell = document.createElement('div');
        cell.className = 'pr-cell' + (r.black ? ' black' : '');
        cell.style.left = (PITCH_W + ci * cellW) + 'px';
        cell.style.top = (ri * cellH) + 'px';
        body.appendChild(cell);
      }
    });

    layoutPianoNotes(clip.events || [], { clip, ppq, cellW, cellH }).forEach(n => {
      const note = document.createElement('div');
      note.className = 'pr-note';
      note.style.left = (PITCH_W + n.x) + 'px';
      note.style.top = n.y + 'px';
      note.style.width = n.width + 'px';
      note.style.height = n.height + 'px';
      note.title = n.note + ' · ' + n.start + ' → ' + (n.start + n.dur) + ' ticks';
      noteEls.set(n.event, note);
      note.addEventListener('pointerdown', (e) => onNoteDown(e, note, n));
      const edgeL = document.createElement('div');
      edgeL.className = 'pr-note-edge pr-note-edge-l';
      edgeL.title = 'Drag to trim the note start';
      edgeL.addEventListener('pointerdown', (e) => onNoteEdgeDown(e, note, n, 'left'));
      const edgeR = document.createElement('div');
      edgeR.className = 'pr-note-edge pr-note-edge-r';
      edgeR.title = 'Drag to trim the note duration';
      edgeR.addEventListener('pointerdown', (e) => onNoteEdgeDown(e, note, n, 'right'));
      note.append(edgeL, edgeR);
      body.appendChild(note);
    });

    // Replace the clip's events through the command history (backlog #25/#26).
    // `mutate` receives a fresh copy of the current events array; its result is
    // committed via editClipEventsCommand so undo/redo work.
    function commitEvents(mutate) {
      const events = (clip.events || []).slice();
      mutate(events);
      if (history && history.execute) {
        history.execute(editClipEventsCommand(engine, sel.trackId, clip.id, events));
      } else {
        engine.setClipEvents(sel.trackId, clip.id, events);
        render();
      }
    }
    commitCtx = { commitEvents, events: clip.events || [] };

    // Grid cell from a viewport position (pitch column / row) relative to the body.
    // With snap on, the column is the floored sixteenth; with snap off it stays
    // fractional so free (sub-sixteenth) positions are possible (backlog #31).
    function cellAt(clientX, clientY) {
      const rect = body.getBoundingClientRect();
      const x = clientX - rect.left - PITCH_W;
      const y = clientY - rect.top;
      return {
        col: snapDiv <= 0 ? x / cellW : Math.floor(x / cellW),
        row: Math.floor(y / cellH),
      };
    }

    // Pointer-drag a note bar: moving it snaps to the step grid and pitch rows;
    // a plain click (no drag) deletes the note (backlog #25 behavior). When the
    // note is part of a marquee selection, the whole selection moves together
    // (backlog #29); a plain click on a selected note just clears the selection.
    function onNoteDown(e, note, n) {
      e.stopPropagation();
      e.preventDefault();
      const g = body._grid;
      const grab = cellAt(e.clientX, e.clientY);
      const isSelected = selected.has(n.event);
      const group = isSelected ? [...selected] : [n.event];
      const snap = group.map(ev => ({
        ev,
        el: noteEls.get(ev),
        col: Math.floor(ev.start / g.stepTicks),
        midi: noteToMidi(ev.note),
        pCol: Math.floor(ev.start / g.stepTicks),
        pMidi: noteToMidi(ev.note),
      }));
      // Audition the pressed note; re-audition as the drag changes its pitch.
      const grabSnap = snap.find(s => s.ev === n.event);
      let audMidi = noteToMidi(n.note);
      auditionOn(n.note, typeof n.event.velocity === 'number' ? n.event.velocity : 100);
      let dragged = false;
      let preview = false;
      const onMove = (evt) => {
        dragged = true;
        const c = cellAt(evt.clientX, evt.clientY);
        const dCol = c.col - grab.col;
        const dRow = c.row - grab.row;
        if (dCol === 0 && dRow === 0) return;
        preview = true;
        snap.forEach(s => {
          const nCol = Math.max(0, Math.min(g.steps - 1, snapCol(s.col + dCol)));
          const nMidi = Math.max(DEFAULT_LOW_MIDI, Math.min(DEFAULT_HIGH_MIDI, s.midi - dRow));
          s.pCol = nCol;
          s.pMidi = nMidi;
          if (s.el) {
            s.el.style.left = (PITCH_W + nCol * cellW) + 'px';
            s.el.style.top = (DEFAULT_HIGH_MIDI - nMidi) * cellH + 'px';
          }
        });
        if (grabSnap && grabSnap.pMidi !== audMidi) {
          auditionOff();
          audMidi = grabSnap.pMidi;
          auditionOn(midiToNote(audMidi), 100);
        }
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        auditionOff();
        if (dragged) {
          if (preview) {
            commitEvents(events => {
              snap.forEach(s => {
                const i = events.indexOf(s.ev);
                if (i >= 0) events[i] = { ...events[i], note: midiToNote(s.pMidi), start: Math.round(s.pCol * g.stepTicks) };
              });
            });
          } else {
            render();
          }
        } else if (isSelected) {
          selected.clear();
          applySelected();
        } else {
          commitEvents(events => { events.splice(events.indexOf(n.event), 1); });
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }

    // Pointer-drag a note edge: trims the start (left) or duration (right),
    // snapped to whole steps, minimum one step.
    function onNoteEdgeDown(e, note, n, edge) {
      e.stopPropagation();
      e.preventDefault();
      const g = body._grid;
      const origCol = Math.floor(n.start / g.stepTicks);
      const origSpan = Math.max(1, Math.ceil((typeof n.dur === 'number' ? n.dur : g.stepTicks) / g.stepTicks));
      let preview = null;
      const onMove = (evt) => {
        const c = cellAt(evt.clientX, evt.clientY);
        const raw = Math.max(0, Math.min(g.steps - 1, snapCol(c.col)));
        let startCol = origCol;
        let span = origSpan;
        if (edge === 'right') {
          span = Math.min(g.steps - origCol, Math.max(1, raw - origCol));
        } else {
          startCol = Math.max(0, Math.min(raw, origCol + origSpan - 1));
          span = origCol + origSpan - startCol;
        }
        if (startCol === origCol && span === origSpan) { preview = null; return; }
        preview = { startCol, span };
        note.style.left = (PITCH_W + startCol * cellW) + 'px';
        note.style.width = Math.max(1, span * cellW) + 'px';
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (preview) {
          commitEvents(events => {
            const i = events.indexOf(n.event);
            if (i >= 0) events[i] = { ...events[i], start: Math.round(preview.startCol * g.stepTicks), dur: Math.round(preview.span * g.stepTicks) };
          });
        } else {
          render();
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }

    // Empty-grid pointer interactions (backlog #25/#29): a plain click on an
    // empty cell adds a one-sixteenth note; a drag draws a marquee box and on
    // release selects every note bar it intersects. Note bars stop propagation,
    // so this handler only sees empty-cell starts.
    body.addEventListener('pointerdown', (e) => {
      const g = body._grid;
      if (!g) return;
      const c = cellAt(e.clientX, e.clientY);
      if (c.col < 0 || c.col >= g.steps || c.row < 0 || c.row >= g.rows.length) return;
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY, col: c.col, row: c.row };
      let moved = false;
      let boxEl = null;
      const onMove = (evt) => {
        if (Math.abs(evt.clientX - start.x) + Math.abs(evt.clientY - start.y) < 4) return;
        moved = true;
        if (!boxEl) {
          boxEl = document.createElement('div');
          boxEl.className = 'pr-marquee';
          body.appendChild(boxEl);
        }
        const rect = body.getBoundingClientRect();
        const x0 = Math.max(0, Math.min(body.clientWidth, start.x - rect.left));
        const y0 = Math.max(0, Math.min(body.clientHeight, start.y - rect.top));
        const x1 = Math.max(0, Math.min(body.clientWidth, evt.clientX - rect.left));
        const y1 = Math.max(0, Math.min(body.clientHeight, evt.clientY - rect.top));
        boxEl.style.left = Math.min(x0, x1) + 'px';
        boxEl.style.top = Math.min(y0, y1) + 'px';
        boxEl.style.width = Math.abs(x1 - x0) + 'px';
        boxEl.style.height = Math.abs(y1 - y0) + 'px';
      };
      const onUp = (evt) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (boxEl) { boxEl.remove(); boxEl = null; }
        if (moved) {
          const rect = body.getBoundingClientRect();
          const x0 = Math.min(start.x, evt.clientX) - rect.left;
          const x1 = Math.max(start.x, evt.clientX) - rect.left;
          const y0 = Math.min(start.y, evt.clientY) - rect.top;
          const y1 = Math.max(start.y, evt.clientY) - rect.top;
          selected.clear();
          layoutPianoNotes(clip.events || [], { clip, ppq, cellW, cellH }).forEach(n => {
            const nx = PITCH_W + n.x;
            const ny = n.y;
            if (nx < x1 && nx + n.width > x0 && ny < y1 && ny + n.height > y0) selected.add(n.event);
          });
          applySelected();
        } else {
          selected.clear();
          applySelected();
          const midi = DEFAULT_HIGH_MIDI - start.row;
          const noteName = midiToNote(midi);
          // Snap the drawn column to the active grid (backlog #31); with snap
          // off the column may be fractional, so the start is rounded to ticks.
          const qCol = Math.max(0, Math.min(g.steps - 1, snapCol(start.col)));
          commitEvents(events => {
            events.push({ note: noteName, start: Math.round(qCol * g.stepTicks), dur: g.stepTicks, velocity: 100 });
          });
          // Audition the drawn note for its step duration (self-terminating).
          const ppq = transport.ppq || 480;
          const bpm = (transport && transport.bpm) || 120;
          auditionOn(noteName, 100, (g.stepTicks / ppq) * (60 / bpm));
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    // Velocity lane below the pitch grid (backlog #27): one bottom-aligned bar
    // per note; dragging a bar up/down sets the note's velocity (1..127, snapped),
    // committed via the command history on release.
    const vel = document.createElement('div');
    vel.className = 'pr-vel';
    vel.style.width = (PITCH_W + gridW) + 'px';
    vel.style.height = VEL_H + 'px';
    const velLabel = document.createElement('div');
    velLabel.className = 'pr-vel-label';
    velLabel.textContent = 'VEL';
    vel.appendChild(velLabel);

    function onVelDown(e, bar, v) {
      e.stopPropagation();
      e.preventDefault();
      let preview = null;
      const onMove = (evt) => {
        const r = vel.getBoundingClientRect();
        const y = Math.max(0, Math.min(VEL_H, evt.clientY - r.top));
        const velocity = Math.max(1, Math.round((1 - y / VEL_H) * 127));
        preview = velocity;
        bar.style.height = Math.max(1, Math.round((velocity / 127) * VEL_H)) + 'px';
        bar.title = v.event.note + ' · velocity ' + velocity;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (preview !== null && preview !== v.velocity) {
          commitEvents(events => {
            const i = events.indexOf(v.event);
            if (i >= 0) events[i] = { ...events[i], velocity: preview };
          });
        } else {
          render();
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }

    layoutVelocityBars(clip.events || [], { clip, ppq, cellW, laneH: VEL_H }).forEach(v => {
      const bar = document.createElement('div');
      bar.className = 'pr-vel-bar';
      bar.style.left = (PITCH_W + v.x) + 'px';
      bar.style.width = v.width + 'px';
      bar.style.height = v.height + 'px';
      bar.title = v.event.note + ' · velocity ' + v.velocity;
      bar.addEventListener('pointerdown', (e) => onVelDown(e, bar, v));
      vel.appendChild(bar);
    });

    body._grid = {
      trackId: sel.trackId,
      clip,
      pitchW: PITCH_W,
      cellW,
      cellH,
      stepTicks,
      steps,
      rows,
    };

    // Step-input cursor (backlog #42): a vertical band over the insert column.
    if (stepMode) {
      const cur = document.createElement('div');
      cur.className = 'pr-cursor';
      const col = Math.max(0, Math.min(stepCol, steps - 1));
      cur.style.left = (PITCH_W + col * cellW) + 'px';
      cur.style.top = '0px';
      cur.style.width = cellW + 'px';
      cur.style.height = gridH + 'px';
      body.appendChild(cur);
    }

    title.textContent = 'PIANO ROLL · ' + clip.name + ' · ' + steps + ' steps';
    gridWrap.append(stepHead, body, vel);
  }

  // Ctrl+wheel zooms the grid (mirrors the arranger's scroll-zoom).
  gridWrap.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.25 : 1 / 1.25);
  }, { passive: false });

  function setSelection(s) {
    auditionOff();
    sel = s ? { trackId: s.trackId, clipId: s.clipId } : null;
    stepCol = 0;
    render();
  }

  // Delete/Backspace removes every selected note as one undoable command; Esc
  // clears the selection (backlog #29). Registered in the capture phase so it
  // beats the arranger's clip-delete handler — and only acts while a note
  // selection exists, so clip deletion still works otherwise.
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    // Step input (backlog #42): note keys insert at the cursor and advance it,
    // arrows move the cursor, Backspace erases under the cursor, Esc exits.
    // Handled before the selection branches below; stopPropagation keeps the
    // live keyboard/monitor path and the arranger shortcuts out of the way.
    if (stepMode && commitCtx && !(e.ctrlKey || e.metaKey || e.altKey)) {
      const k = (e.key || '').toLowerCase();
      if (Object.prototype.hasOwnProperty.call(STEP_KEYS, k)) {
        e.preventDefault();
        e.stopPropagation();
        stepInsert(STEP_KEYS[k]);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        const g = stepGeom();
        if (g) stepCol = Math.max(0, Math.min(stepCol + (e.key === 'ArrowRight' ? g.advance : -g.advance), g.steps - 1));
        render();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        stepErase();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        auditionOff();
        selected.clear();
        setStepMode(false);
        return;
      }
      // Delete falls through to the selection branch below (same semantics).
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size && commitCtx) {
      e.preventDefault();
      e.stopPropagation();
      commitCtx.commitEvents(events => {
        selected.forEach(ev => {
          const i = events.indexOf(ev);
          if (i >= 0) events.splice(i, 1);
        });
        events.sort((a, b) => (a.start || 0) - (b.start || 0));
      });
      return;
    }
    if (e.key === 'Escape' && selected.size) {
      e.preventDefault();
      auditionOff();
      selected.clear();
      applySelected();
    }
    // Ctrl/Cmd+D duplicates the selected notes, placing the copy right after
    // the selection's span (backlog #35). Runs through the history so undo
    // works; a no-op without a selection.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selected.size && commitCtx) {
      e.preventDefault();
      e.stopPropagation();
      const ppq = transport.ppq || 480;
      commitCtx.commitEvents(events => {
        const selectedEvents = events.filter(ev => selected.has(ev));
        const copies = duplicateEvents(selectedEvents, { stepTicks: Math.max(1, ppq / 4) });
        copies.forEach(ev => events.push(ev));
        events.sort((a, b) => (a.start || 0) - (b.start || 0));
      });
    }
  }, true);

  if (history && history.subscribe) history.subscribe(() => render());

  render();

  return { el, render, setSelection };
}
