import { stepTicks } from './clipEvents.js';

// The step grid displays the last event in each cell. Edit that event only;
// chords, off-grid positions and unedited duration/expression stay intact.
export function editStepEvent(events, step, patch, { ppq = 480, remove = false } = {}) {
  if (!Number.isInteger(step) || step < 0 || step >= 16) return events.map(ev => ({ ...ev }));
  const width = stepTicks(ppq);
  let index = -1;
  events.forEach((ev, i) => { if (Math.floor(ev.start / width) === step) index = i; });
  const result = events.map(ev => ({ ...ev }));
  if (remove) {
    if (index !== -1) result.splice(index, 1);
    return result;
  }
  const note = index === -1 ? { start: step * width, dur: width, velocity: 100 } : result[index];
  if (patch.note) note.note = patch.note;
  if (Number.isFinite(patch.dur) && patch.dur > 0) note.dur = patch.dur * width;
  if (Number.isFinite(patch.vel)) note.velocity = Math.max(0, Math.min(127, patch.vel));
  if (index === -1) result.push(note);
  return result.sort((a, b) => a.start - b.start);
}
