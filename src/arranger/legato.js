// Piano-roll monophonic legato (backlog #36): extends each note so it lasts
// until the start of the next note (the chronologically next event with a
// strictly greater start). Notes never get shortened — a note that already
// reaches its successor is left untouched, and the last note has no successor
// so it keeps its duration. Pure — no DOM — unit-testable in the browser.

// Returns a new array in the same order as the input; unchanged events keep
// their reference so callers can detect what actually changed.
export function legatoEvents(events) {
  const list = (events || []).slice();
  const sorted = list.slice().sort((a, b) => (a.start || 0) - (b.start || 0));
  const nextStart = new Map();
  sorted.forEach((ev, i) => {
    const start = ev.start || 0;
    for (let j = i + 1; j < sorted.length; j++) {
      if ((sorted[j].start || 0) > start) { nextStart.set(ev, sorted[j].start || 0); break; }
    }
  });
  return list.map(ev => {
    const ns = nextStart.get(ev);
    if (ns === undefined) return ev;
    const start = ev.start || 0;
    const target = ns - start;
    if (target <= (typeof ev.dur === 'number' ? ev.dur : 0)) return ev;
    return { ...ev, dur: target };
  });
}