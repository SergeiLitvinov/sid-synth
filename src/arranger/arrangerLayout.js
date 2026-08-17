// Pure arranger geometry: musical ticks -> pixels for the linear timeline.
// No DOM, no AudioContext — unit-testable in the browser like the rest of src/project.
// Horizontal axis is musical time; a quarter note is `ppq` ticks wide by default
// at zoom `pxPerQuarter`. Bar boundaries walk the tempo map so time-signature
// changes shift the ruler correctly.

import { barLengthTicks } from '../project/musicalTime.js';
import { signatureAt } from '../project/tempoMap.js';

export const STEPS_PER_LOOP = 16;

// tick -> x (px) in a viewport whose left edge is at `originTicks`.
export function ticksToX(ticks, { pxPerQuarter = 48, ppq = 480, originTicks = 0 } = {}) {
  return ((ticks - originTicks) / ppq) * pxPerQuarter;
}

// x (px) -> tick, inverse of ticksToX.
export function xToTicks(x, { pxPerQuarter = 48, ppq = 480, originTicks = 0 } = {}) {
  return originTicks + (x / pxPerQuarter) * ppq;
}

// Round a tick position to the nearest snap grid line. Default grid = one
// sixteenth note (ppq/4), matching the step-recorder step length.
export function snapTicks(ticks, { ppq = 480, grid = ppq / 4 } = {}) {
  const g = grid > 0 ? grid : ppq / 4;
  return Math.max(0, Math.round(ticks / g) * g);
}

// Length of one bar in ticks at the signature in effect at `tick`.
export function barLenTicksAt(tempoMap, tick) {
  const sig = signatureAt(tempoMap, tick);
  return barLengthTicks(sig, tempoMap.ppq);
}

// Ruler geometry for bars [0, bars): one entry per bar with its pixel span and
// the tick range it covers (signature changes honored bar by bar).
export function computeRuler(tempoMap, bars, opts = {}) {
  const out = [];
  let tick = 0;
  for (let b = 0; b < bars; b++) {
    const len = barLenTicksAt(tempoMap, tick);
    const x = ticksToX(tick, opts);
    const width = ticksToX(tick + len, opts) - x;
    out.push({ bar: b, startTicks: tick, endTicks: tick + len, x, width });
    tick += len;
  }
  return out;
}

// Total pixel width of `bars` bars of music at the current zoom.
export function contentWidthTicks(tempoMap, bars) {
  let tick = 0;
  for (let b = 0; b < bars; b++) tick += barLenTicksAt(tempoMap, tick);
  return tick;
}

// MIDI clip geometry: each clip spans [start, start+length] ticks on the shared
// timeline. Returns { id, name, color, x, width, startTicks, lengthTicks }.
// clips without a color fall back to the track color in the caller.
export function layoutClips(track, { pxPerQuarter = 48, ppq = 480, originTicks = 0 } = {}) {
  return (track.clips || []).map(clip => ({
    id: clip.id,
    name: clip.name,
    color: clip.color || track.color || null,
    startTicks: clip.start,
    lengthTicks: clip.length,
    x: ticksToX(clip.start, { pxPerQuarter, ppq, originTicks }),
    width: ticksToX(clip.start + clip.length, { pxPerQuarter, ppq, originTicks }) - ticksToX(clip.start, { pxPerQuarter, ppq, originTicks }),
  }));
}

// Clip note geometry: each event becomes a mini-note inside the clip, with
// x/width relative to the clip's own top-left (so the caller can absolutely
// position them inside the clip block). Events outside the clip span are kept
// but clamp to the clip bounds in px space. Returns { note, x, width }.
export function layoutClipNotes(clip, { pxPerQuarter = 48, ppq = 480, originTicks = 0 } = {}) {
  const clipX = ticksToX(clip.start, { pxPerQuarter, ppq, originTicks });
  return (clip.events || []).map(ev => {
    const x = ticksToX(clip.start + ev.start, { pxPerQuarter, ppq, originTicks }) - clipX;
    const width = ticksToX(clip.start + ev.start + (ev.dur || ppq / 4), { pxPerQuarter, ppq, originTicks }) - clipX - x;
    return {
      note: ev.note,
      x: Math.max(0, x),
      width: Math.max(1, width),
    };
  });
}

// Track pattern geometry: the 16-step grid rendered as blocks on the timeline.
// The pattern repeats once per bar (a 16-step 4/4 loop is exactly one bar), so
// the blocks match what the step engine actually plays across loop repeats.
// Returns { x, width, note, dur } blocks (pixel x/width in the shared timeline).
export function layoutTrackBlocks(track, { bars, pxPerQuarter = 48, ppq = 480, originTicks = 0 } = {}) {
  const stepTicks = ppq / 4; // sixteenth note
  const loopLenTicks = STEPS_PER_LOOP * stepTicks;
  const blocks = [];
  for (let b = 0; b < bars; b++) {
    const loopStart = b * loopLenTicks;
    for (let s = 0; s < STEPS_PER_LOOP; s++) {
      const cell = track.grid ? track.grid[s] : null;
      if (!cell) continue;
      const note = typeof cell === 'string' ? cell : cell.note;
      const dur = (cell && typeof cell === 'object' && typeof cell.dur === 'number' && cell.dur > 0) ? cell.dur : 1;
      const startTicks = loopStart + s * stepTicks;
      const durTicks = Math.max(stepTicks, dur * stepTicks);
      blocks.push({
        x: ticksToX(startTicks, { pxPerQuarter, ppq, originTicks }),
        width: ticksToX(startTicks + durTicks, { pxPerQuarter, ppq, originTicks }) - ticksToX(startTicks, { pxPerQuarter, ppq, originTicks }),
        note,
        dur,
      });
    }
  }
  return blocks;
}
