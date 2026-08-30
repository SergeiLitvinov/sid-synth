// Piano-roll transpose (backlog #34): shifts note pitches by a semitone
// interval, clamped into the editor's pitch range (C3..B4 by default). Pure —
// no DOM — unit-testable in the browser.

import { noteToMidi, midiToNote, DEFAULT_LOW_MIDI, DEFAULT_HIGH_MIDI } from './pianoRollLayout.js';

// Shift a MIDI note number by `semitones`, clamped into [min, max].
export function transposeMidi(midi, semitones, { min = DEFAULT_LOW_MIDI, max = DEFAULT_HIGH_MIDI } = {}) {
  return Math.max(min, Math.min(max, (midi || 0) + semitones));
}

// Shift every event's pitch by `semitones`, preserving start/dur/velocity and
// any extra fields. Events whose pitch is unchanged (semitones 0, an unknown
// note name, or an already-clamped boundary) keep their reference so callers
// can detect what actually moved.
export function transposeEvents(events, semitones, opts = {}) {
  if (!semitones) return events;
  return (events || []).map(ev => {
    const midi = noteToMidi(ev.note);
    if (midi === null) return ev;
    const shifted = transposeMidi(midi, semitones, opts);
    return shifted === midi ? ev : { ...ev, note: midiToNote(shifted) };
  });
}
