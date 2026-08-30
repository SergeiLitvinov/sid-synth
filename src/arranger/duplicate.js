// Piano-roll note duplication (backlog #35): Ctrl+D duplicates the selected
// notes, placing the copy right after the selection's span (the phrase length)
// so it tiles seamlessly. Pure — no DOM — unit-testable in the browser.

// The offset for a duplicate: the span of the selection (latest end minus
// earliest start), never shorter than one step so a single zero-length note
// still produces a gap. Returns 0 for an empty selection.
export function duplicateOffset(events, { stepTicks = 120 } = {}) {
  if (!events || !events.length) return 0;
  let minStart = Infinity;
  let maxEnd = -Infinity;
  events.forEach(ev => {
    const s = ev.start || 0;
    const e = s + (typeof ev.dur === 'number' ? ev.dur : stepTicks);
    minStart = Math.min(minStart, s);
    maxEnd = Math.max(maxEnd, e);
  });
  return Math.max(stepTicks, maxEnd - minStart);
}

// Copy each event shifted by the selection's phrase length. Returns a new array
// of fresh objects (start is offset, every other field preserved).
export function duplicateEvents(events, opts = {}) {
  const offset = duplicateOffset(events, opts);
  if (!offset) return events;
  return (events || []).map(ev => ({ ...ev, start: (ev.start || 0) + offset }));
}