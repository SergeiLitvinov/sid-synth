import { createLowpass } from './lp.js';
import { createHighpass } from './hp.js';
import { createBandpass } from './bp.js';
import { createNonlinearFilter } from './nonlinear.js';

export function lowpass(ctx, freq, Q) { return createLowpass(ctx, freq, Q); }
export function highpass(ctx, freq, Q) { return createHighpass(ctx, freq, Q); }
export function bandpass(ctx, freq, Q) { return createBandpass(ctx, freq, Q); }
export function nonlinear(ctx) { return createNonlinearFilter(ctx); }

export function create(type, ctx, freq, Q) {
  switch (type) {
    case 'lowpass': return lowpass(ctx, freq, Q);
    case 'highpass': return highpass(ctx, freq, Q);
    case 'bandpass': return bandpass(ctx, freq, Q);
    case 'nonlinear': return nonlinear(ctx);
    default: return lowpass(ctx, freq, Q);
  }
}
