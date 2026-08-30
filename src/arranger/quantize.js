// Note quantization for the piano roll (backlog #33): snaps note starts toward
// a swing grid with adjustable strength. Pure — no DOM — unit-testable in the
// browser. `grid` is the sixteenth divisor (1 = 1/16, 2 = 1/8, 4 = 1/4);
// `swing` (0-100) delays every second grid slot by swing% of the slot duration
// (the swung off-beat); `strength` (0-100) pulls each start part-way to the
// target (100 = full snap). Starts are never pulled below 0.

// The quantize grid step in ticks: `grid` sixteenths of one step (ppq/4).
export function quantizeGridTicks(ppq = 480, grid = 1) {
  return Math.max(1, (ppq / 4) * Math.max(1, Math.round(grid)));
}

// Quantize one note start to the (swung) grid. Returns the new tick position.
export function quantizeStart(start, { ppq = 480, grid = 1, strength = 100, swing = 0 } = {}) {
  const step = quantizeGridTicks(ppq, grid);
  const slot = Math.round(start / step);
  let target = slot * step;
  // Odd slot = the off-beat of a grid pair — the swing pushes it later.
  if (slot % 2 === 1) target += (swing / 100) * step;
  const k = Math.max(0, Math.min(1, strength / 100));
  return Math.max(0, Math.round(start + (target - start) * k));
}

// Quantize a list of note events, returning a new array (unchanged events are
// kept by reference so callers can detect what moved).
export function quantizeEvents(events, opts = {}) {
  return (events || []).map(ev => {
    const start = quantizeStart(ev.start || 0, opts);
    return start === (ev.start || 0) ? ev : { ...ev, start };
  });
}