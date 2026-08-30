// Pure piano-roll geometry (backlog #25): MIDI <-> note-name helpers and the
// step/pitch grid layout for a clip's events. No DOM — unit-testable in the
// browser. A note event is { note, start, dur } in PPQ ticks relative to the
// clip start; the grid quantizes to sixteenths (stepTicks = ppq/4), matching
// the step engine's grid.

const PITCHES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// "C4" -> 60, "A3" -> 57, "C#4" -> 61. Returns null for unknown names.
export function noteToMidi(note) {
  const m = String(note || '').toUpperCase().match(/^([A-G]#?)(-?\d+)$/);
  if (!m) return null;
  const semi = PITCHES.indexOf(m[1]);
  if (semi < 0) return null;
  return (parseInt(m[2], 10) + 1) * 12 + semi;
}

// 60 -> "C4", 61 -> "C#4", 36 -> "C2". Handles negative octaves by the formula.
export function midiToNote(midi) {
  return PITCHES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

// The pitch ladder covers two octaves by default (C3..B4), which contains the
// app's default grid notes. Rows are listed top-first (high pitch at the top).
export const DEFAULT_LOW_MIDI = 48;   // C3
export const DEFAULT_HIGH_MIDI = 71;  // B4

export function pianoRows(low = DEFAULT_LOW_MIDI, high = DEFAULT_HIGH_MIDI) {
  const rows = [];
  for (let midi = high; midi >= low; midi--) {
    rows.push({ midi, note: midiToNote(midi), black: PITCHES[midi % 12].includes('#') });
  }
  return rows;
}

// Column count for a clip: one column per sixteenth step of the clip length.
// Returns { stepTicks, steps }.
export function pianoSteps(clip, ppq = 480) {
  const stepTicks = Math.max(1, ppq / 4);
  const steps = Math.max(1, Math.ceil((clip.length || stepTicks) / stepTicks));
  return { stepTicks, steps };
}

// Layout each event as a bar on the grid. Bars outside the pitch range are
// skipped (they stay in clip.events, just not drawn). Each bar is positioned by
// its step column (start / stepTicks) and pitch row (high - midi). `event`
// carries a reference to the source event so editors can mutate exactly it.
export function layoutPianoNotes(events, { clip, ppq = 480, cellW = 18, cellH = 12, low = DEFAULT_LOW_MIDI, high = DEFAULT_HIGH_MIDI } = {}) {
  const { stepTicks, steps } = pianoSteps(clip, ppq);
  const bars = [];
  (events || []).forEach(ev => {
    const midi = noteToMidi(ev.note);
    if (midi === null || midi < low || midi > high) return;
    const col = Math.floor((ev.start || 0) / stepTicks);
    const span = Math.max(1, Math.ceil((typeof ev.dur === 'number' ? ev.dur : stepTicks) / stepTicks));
    const x = col * cellW;
    const y = (high - midi) * cellH;
    const width = Math.max(0, Math.min(span, steps - col)) * cellW;
    bars.push({ note: ev.note, midi, start: ev.start, dur: ev.dur, x, y, width, height: cellH, event: ev });
  });
  return bars;
}

// Layout one velocity bar per event (backlog #27), stacked in a lane below the
// pitch grid. Unlike layoutPianoNotes this keeps EVERY event (out-of-range
// pitches still have a column): `x`/`width` follow the step grid, `height` is
// velocity/127 of the lane height (clamped 1..127, default 100), bottom-aligned.
export function layoutVelocityBars(events, { clip, ppq = 480, cellW = 18, laneH = 40 } = {}) {
  const { stepTicks, steps } = pianoSteps(clip, ppq);
  return (events || []).map(ev => {
    const col = Math.floor((ev.start || 0) / stepTicks);
    const span = Math.max(1, Math.ceil((typeof ev.dur === 'number' ? ev.dur : stepTicks) / stepTicks));
    const width = Math.max(0, Math.min(span, steps - col)) * cellW;
    const velocity = Math.max(1, Math.min(127, typeof ev.velocity === 'number' ? ev.velocity : 100));
    return { event: ev, col, span, velocity, x: col * cellW, width, height: Math.max(1, Math.round((velocity / 127) * laneH)), laneH };
  });
}
