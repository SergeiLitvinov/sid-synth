import { stepTicks } from './clipEvents.js';

// The step grid displays the last event in each cell. Edit that event only;
// chords, off-grid positions and unedited duration/expression stay intact.
// Columns address the clip window: pass the clip offset so split/trimmed
// clips edit their sounding region, not raw source ticks.
export function editStepEvent(events, step, patch, { ppq = 480, remove = false, offset = 0 } = {}) {
  if (!Number.isInteger(step) || step < 0 || step >= 16) return events.map(ev => ({ ...ev }));
  const width = stepTicks(ppq);
  const off = typeof offset === 'number' && offset >= 0 ? offset : 0;
  let index = -1;
  events.forEach((ev, i) => { if (Math.floor(((ev.start || 0) - off) / width) === step) index = i; });
  const result = events.map(ev => ({ ...ev }));
  if (remove) {
    if (index !== -1) result.splice(index, 1);
    return result;
  }
  const note = index === -1 ? { start: off + step * width, dur: width, velocity: 100 } : result[index];
  if (patch.note) note.note = patch.note;
  if (Number.isFinite(patch.dur) && patch.dur > 0) note.dur = patch.dur * width;
  if (Number.isFinite(patch.vel)) note.velocity = Math.max(0, Math.min(127, patch.vel));
  if (index === -1) result.push(note);
  return result.sort((a, b) => a.start - b.start);
}
