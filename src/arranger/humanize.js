// Piano-roll humanize (backlog #39): randomly nudges note starts (timing) and
// velocities to give a performed, human feel. `timing` (0-100) is the max
// random start offset as a percentage of the snap grid step; `velocity`
// (0-127) is the max random velocity deviation, clamped to 1..127. `random`
// may be injected for deterministic tests (defaults to Math.random). Pure — no
// DOM — unit-testable in the browser.

import { quantizeGridTicks } from './quantize.js';

// Humanize one note start by a random offset of up to ±(timing/100)*step ticks
// (never below 0). A timing of 0 (or a step of 0) leaves the start untouched.
export function humanizeStart(start, { step = 120, timing = 30, random = Math.random } = {}) {
  const max = (timing / 100) * step;
  if (!max) return start;
  const off = Math.round((random() - 0.5) * 2 * max);
  return Math.max(0, Math.round(start + off));
}

// Humanize one note velocity by a random deviation of up to ±amount, clamped
// into 1..127. An amount of 0 leaves the velocity untouched.
export function humanizeVelocity(vel, { amount = 20, random = Math.random } = {}) {
  if (!amount || typeof vel !== 'number') return vel;
  const off = Math.round((random() - 0.5) * 2 * amount);
  return Math.max(1, Math.min(127, Math.round(vel + off)));
}

// Humanize a list of note events, returning a new array. Events whose start
// AND velocity both came out unchanged keep their reference so callers can
// detect what actually changed. `step` is derived from the sixteenth grid
// (same grid as quantize/fixed length).
export function humanizeEvents(events, { ppq = 480, grid = 1, timing = 30, velocity = 20, random = Math.random } = {}) {
  const step = quantizeGridTicks(ppq, grid);
  return (events || []).map(ev => {
    const start = humanizeStart(ev.start || 0, { step, timing, random });
    const vel = humanizeVelocity(ev.velocity, { amount: velocity, random });
    if (start === (ev.start || 0) && vel === ev.velocity) return ev;
    const out = { ...ev, start };
    if (vel !== ev.velocity) out.velocity = vel;
    return out;
  });
}