export const NOTES = {
  'C2': 65.41, 'C#2': 69.30, 'D2': 73.42, 'D#2': 77.78, 'E2': 82.41, 'F2': 87.31, 'F#2': 92.50, 'G2': 98.00, 'G#2': 103.83, 'A2': 110.00, 'A#2': 116.54, 'B2': 123.47,
  'C3': 130.81, 'C#3': 138.59, 'D3': 146.83, 'D#3': 155.56, 'E3': 164.81, 'F3': 174.61, 'F#3': 185.00, 'G3': 196.00, 'G#3': 207.65, 'A3': 220.00, 'A#3': 233.08, 'B3': 246.94,
  'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13, 'E4': 329.63, 'F4': 349.23, 'F#4': 369.99, 'G4': 392.00, 'G#4': 415.30, 'A4': 440.00, 'A#4': 466.16, 'B4': 493.88
};

export function noteToFreq(note) {
  const match = /^([A-G])(#?)(-?\d+)$/i.exec(note || '');
  if (!match) return 440;
  const pitch = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()];
  const midi = (Number(match[3]) + 1) * 12 + pitch + (match[2] ? 1 : 0);
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function resolveNote(note) {
  return NOTES[note] ? note : (NOTES[note + '3'] ? note + '3' : null);
}

export function noteForMidi(midiNote) {
  if (!Number.isInteger(midiNote) || midiNote < 0 || midiNote > 127) return undefined;
  return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][midiNote % 12]
    + (Math.floor(midiNote / 12) - 1);
}
