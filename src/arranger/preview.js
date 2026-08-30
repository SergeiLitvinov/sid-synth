// Preview (backlog #40): audition a transformed note list through one track's
// voice without committing it. Each event is scheduled at its own musical
// offset (start ticks -> seconds via tempo), so timing transforms (quantize
// swing, humanize) are audible before they are applied. Pure timing math —
// the audio callback is injected, no DOM, no AudioContext.

import { ticksPerSecond } from '../project/clipEvents.js';

// Schedule every event once via `schedule(note, velocity, durSec, whenAbs)`.
// `now` anchors the offsets (pass ctx.currentTime); `lead` delays the whole
// pass slightly so the first notes are not clipped by scheduling latency.
// Events without a positive duration sound as one sixteenth. Returns the
// number of scheduled notes.
export function previewEvents(events, { bpm = 120, ppq = 480, schedule, now = 0, lead = 0.06 } = {}) {
  if (!schedule) return 0;
  const tps = ticksPerSecond(bpm, ppq);
  let n = 0;
  (events || []).forEach(ev => {
    if (!ev) return;
    const durTicks = typeof ev.dur === 'number' && ev.dur > 0 ? ev.dur : ppq / 4;
    schedule(
      ev.note,
      typeof ev.velocity === 'number' ? ev.velocity : 100,
      durTicks / tps,
      now + lead + (typeof ev.start === 'number' ? ev.start : 0) / tps,
    );
    n++;
  });
  return n;
}
