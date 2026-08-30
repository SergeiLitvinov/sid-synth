// Piano-roll fixed length (backlog #37): sets every note's duration to the
// active snap grid step (1/16 when snap is off), turning a mixed-length phrase
// into uniform grid-length notes. `grid` is the sixteenth divisor (1 = 1/16,
// 2 = 1/8, 4 = 1/4), same grid as quantize. Pure — no DOM — unit-testable in
// the browser.

import { quantizeGridTicks } from './quantize.js';

// The fixed length in ticks for the grid step.
export function fixedLengthDur(ppq = 480, grid = 1) {
  return quantizeGridTicks(ppq, grid);
}

// Returns a new array in the same order as the input; events whose duration
// already equals the fixed length keep their reference so callers can detect
// what actually changed.
export function fixedLengthEvents(events, { ppq = 480, grid = 1 } = {}) {
  const dur = fixedLengthDur(ppq, grid);
  return (events || []).map(ev => {
    if (typeof ev.dur === 'number' && ev.dur === dur) return ev;
    return { ...ev, dur };
  });
}