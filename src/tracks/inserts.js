import { Delay } from '../effects/delay.js';
import { Reverb } from '../effects/reverb.js';

// Insert devices for the instrument-track device chain (backlog #32):
// SID instrument (track voice) -> inserts -> fader -> master. Each insert is a
// plain-data descriptor `{ id, type, params }` in the track model; the live
// device is built on demand from the descriptor. `createInsert` returns an
// audio device exposing `{ input, output, connect(dest), disconnect(), setParam }`
// (Delay/Reverb already speak this shape); unknown types return null.

export const INSERT_TYPES = ['delay', 'reverb'];

export function defaultInsertParams(type) {
  switch (type) {
    case 'delay': return { time: 0.3, feedback: 0.4, mix: 0.3 };
    case 'reverb': return { mix: 0.3 };
    default: return {};
  }
}

export function createInsert(ctx, { type, params } = {}) {
  if (type === 'delay') {
    const p = { ...defaultInsertParams('delay'), ...(params || {}) };
    const dev = new Delay(ctx, {
      time: p.time,
      feedback: p.feedback,
      dry: 1 - p.mix,
      wet: p.mix,
    });
    dev.setParam = (key, v) => {
      if (key === 'time') dev.setTime(v);
      else if (key === 'feedback') dev.setFeedback(v);
      else if (key === 'mix') dev.setMix(1 - v, v);
    };
    return dev;
  }
  if (type === 'reverb') {
    const p = { ...defaultInsertParams('reverb'), ...(params || {}) };
    const dev = new Reverb(ctx, { dry: 1 - p.mix, wet: p.mix });
    dev.setParam = (key, v) => {
      if (key === 'mix') dev.setMix(1 - v, v);
    };
    return dev;
  }
  return null;
}