// Clip event conversions: 16-step grid / realtime notes (seconds) <-> MIDI
// clip events (PPQ ticks). Pure — no DOM, no AudioContext — unit-testable.
// A sixteenth note is ppq/4 ticks; realtime seconds convert via the tempo map.

import { DEFAULT_PPQ } from './musicalTime.js';

// Ticks in one sixteenth note at the given ppq.
export function stepTicks(ppq = DEFAULT_PPQ) {
  return ppq / 4;
}

// Ticks in one realtime second at the given tempo/ppq.
export function ticksPerSecond(bpm = 120, ppq = DEFAULT_PPQ) {
  return (bpm / 60) * ppq;
}

// 16-step grid (cells { note, dur, vel } or legacy strings) -> clip events.
// Each event is { note, start, dur, velocity } in ticks, one per filled cell.
// `dur` is the cell's step count times one sixteenth; step index * one
// sixteenth. A cell's `vel` (0-127) maps to the event's `velocity` (default 100).
export function gridToClipEvents(grid, { ppq = DEFAULT_PPQ } = {}) {
  const st = stepTicks(ppq);
  const out = [];
  (grid || []).forEach((cell, step) => {
    if (!cell) return;
    const c = typeof cell === 'string' ? { note: cell, dur: 1 } : cell;
    const dur = typeof c.dur === 'number' && c.dur > 0 ? c.dur : 1;
    out.push({ note: c.note, start: step * st, dur: dur * st, velocity: typeof c.vel === 'number' ? c.vel : 100 });
  });
  return out;
}

// Realtime notes (seconds) -> clip events in ticks. Velocity (0-127) passes
// through when present, otherwise defaults to 100.
export function rtToClipEvents(rt, { bpm = 120, ppq = DEFAULT_PPQ } = {}) {
  const tps = ticksPerSecond(bpm, ppq);
  return (rt || []).map(ev => ({
    note: ev.note,
    start: (typeof ev.start === 'number' ? ev.start : 0) * tps,
    dur: (typeof ev.dur === 'number' ? ev.dur : 0) * tps,
    velocity: typeof ev.velocity === 'number' ? ev.velocity : 100,
  }));
}

// Merge grid + realtime events, sorted by start tick (stable within a tick).
export function mergeClipEvents(gridEvents, rtEvents) {
  return [...gridEvents, ...rtEvents].sort((a, b) => a.start - b.start);
}

// Clip events (ticks) -> 16-step grid, quantized to the loop's step grid.
// Only events in the first loop (start < loop length) are kept; the cell
// holding each event's quantized step is set to { note, dur, vel }.
export function clipEventsToGrid(events, { ppq = DEFAULT_PPQ, steps = 16 } = {}) {
  const st = stepTicks(ppq);
  const grid = Array(steps).fill(null);
  (events || []).forEach(ev => {
    const step = Math.floor(ev.start / st);
    if (step < 0 || step >= steps) return;
    const durSteps = Math.max(1, Math.round((typeof ev.dur === 'number' ? ev.dur : st) / st));
    const cell = { note: ev.note, dur: durSteps };
    if (typeof ev.velocity === 'number') cell.vel = ev.velocity;
    grid[step] = cell;
  });
  return grid;
}

// Clip events (ticks) -> realtime notes (seconds) at the given tempo.
// Velocity (0-127) passes through when present.
export function clipEventsToRt(events, { bpm = 120, ppq = DEFAULT_PPQ } = {}) {
  const tps = ticksPerSecond(bpm, ppq);
  return (events || []).map(ev => ({
    note: ev.note,
    start: ev.start / tps,
    dur: (typeof ev.dur === 'number' ? ev.dur : 0) / tps,
    ...(typeof ev.velocity === 'number' ? { velocity: ev.velocity } : {}),
  }));
}