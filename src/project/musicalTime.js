// Musical time helpers: PPQ-based ticks, bars/beats/ticks conversion.
// Pure — no DOM, no AudioContext — so it can be unit-tested in the browser.
// A beat of a time signature num/den is a den-th note; a quarter note is ppq ticks.

export const DEFAULT_PPQ = 480;

export function beatTicks(beats, ppq = DEFAULT_PPQ) {
  return beats * ppq;
}

// Length of one bar (in ticks) for a time signature { num, den }.
export function barLengthTicks(sig, ppq = DEFAULT_PPQ) {
  return sig.num * ppq * (4 / sig.den);
}

// Start tick of bar index `bar` (0-based) with a constant signature.
export function barStartTicks(bar, sig, ppq = DEFAULT_PPQ) {
  return bar * barLengthTicks(sig, ppq);
}

// { bar, beat, tick } -> ticks (bar/beat 0-based, tick 0-based within beat).
export function musicalToTicks(m, sig, ppq = DEFAULT_PPQ) {
  return barStartTicks(m.bar, sig, ppq) + m.beat * (ppq * 4 / sig.den) + m.tick;
}

// ticks -> { bar, beat, tick } under a constant signature.
export function ticksToMusical(ticks, sig, ppq = DEFAULT_PPQ) {
  const len = barLengthTicks(sig, ppq);
  const bar = Math.floor(ticks / len);
  const remaining = ticks % len;
  const beatLen = ppq * 4 / sig.den;
  const beat = Math.floor(remaining / beatLen);
  const tick = Math.round(remaining % beatLen);
  return { bar, beat, tick };
}