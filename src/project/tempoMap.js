// Tempo map: ordered tempo and time-signature events over musical time.
// Ticks are PPQ-relative; seconds conversion walks the tempo events.
// Pure module — unit-testable in the browser like the rest of src/project.

import { DEFAULT_PPQ, barLengthTicks, ticksToMusical } from './musicalTime.js';

export function createTempoMap({ ppq = DEFAULT_PPQ, bpm = 120, num = 4, den = 4 } = {}) {
  return {
    ppq,
    tempos: [{ ticks: 0, bpm }],
    signatures: [{ ticks: 0, num, den }],
  };
}

// Last tempo event at or before `ticks`.
export function tempoAt(map, ticks) {
  let bpm = map.tempos[0].bpm;
  for (const ev of map.tempos) {
    if (ev.ticks <= ticks) bpm = ev.bpm;
    else break;
  }
  return bpm;
}

// Last signature event at or before `ticks`.
export function signatureAt(map, ticks) {
  let sig = map.signatures[0];
  for (const ev of map.signatures) {
    if (ev.ticks <= ticks) sig = ev;
    else break;
  }
  return { num: sig.num, den: sig.den };
}

export function addTempo(map, ticks, bpm) {
  map.tempos = map.tempos.filter((ev) => ev.ticks !== ticks);
  map.tempos.push({ ticks, bpm });
  map.tempos.sort((a, b) => a.ticks - b.ticks);
}

export function addSignature(map, ticks, num, den) {
  map.signatures = map.signatures.filter((ev) => ev.ticks !== ticks);
  map.signatures.push({ ticks, num, den });
  map.signatures.sort((a, b) => a.ticks - b.ticks);
}

// Start tick of bar index `bar`, walking signature changes bar by bar.
function barStartTicksAcross(map, bar) {
  let ticks = 0;
  for (let b = 0; b < bar; b++) {
    const sig = signatureAt(map, ticks);
    ticks += barLengthTicks(sig, map.ppq);
  }
  return ticks;
}

export function ticksToSeconds(map, ticks) {
  if (ticks <= 0) return 0;
  const ts = [...map.tempos].sort((a, b) => a.ticks - b.ticks);
  let seconds = 0;
  let i = 0;
  for (; i < ts.length; i++) {
    const next = ts[i + 1];
    if (!next || next.ticks >= ticks) break;
    seconds += (next.ticks - ts[i].ticks) * 60 / (ts[i].bpm * map.ppq);
  }
  const cur = ts[i];
  seconds += (ticks - cur.ticks) * 60 / (cur.bpm * map.ppq);
  return seconds;
}

export function secondsToTicks(map, seconds) {
  if (seconds <= 0) return 0;
  const ts = [...map.tempos].sort((a, b) => a.ticks - b.ticks);
  let ticks = 0;
  let acc = 0;
  for (let i = 0; i < ts.length; i++) {
    const next = ts[i + 1];
    if (!next) {
      ticks += (seconds - acc) * map.ppq * ts[i].bpm / 60;
      break;
    }
    const span = (next.ticks - ts[i].ticks) * 60 / (ts[i].bpm * map.ppq);
    if (acc + span >= seconds) {
      ticks += (seconds - acc) * map.ppq * ts[i].bpm / 60;
      break;
    }
    acc += span;
    ticks = next.ticks;
  }
  return ticks;
}

// ticks -> { bar, beat, tick }, walking bar lengths so signature changes
// are honored consistently with musicalTimeToTicks.
export function ticksToMusicalTime(map, ticks) {
  let pos = 0;
  let bar = 0;
  for (;;) {
    const sig = signatureAt(map, pos);
    const len = barLengthTicks(sig, map.ppq);
    if (pos + len > ticks) {
      const within = ticks - pos;
      const beatLen = map.ppq * 4 / sig.den;
      const beat = Math.floor(within / beatLen);
      const tick = Math.round(within % beatLen);
      return { bar, beat, tick };
    }
    pos += len;
    bar++;
  }
}

// { bar, beat, tick } -> ticks using the signature in effect at the bar start.
export function musicalTimeToTicks(map, m) {
  const start = barStartTicksAcross(map, m.bar);
  const sig = signatureAt(map, start);
  return start + m.beat * (map.ppq * 4 / sig.den) + m.tick;
}