export { createLowpass } from './lp.js';
export { createHighpass } from './hp.js';
export { createBandpass } from './bp.js';
export { createNonlinearFilter } from './nonlinear.js';

export function create(type, ctx, freq, Q) {
  switch (type) {
    case 'lowpass': return createLowpass(ctx, freq, Q);
    case 'highpass': return createHighpass(ctx, freq, Q);
    case 'bandpass': return createBandpass(ctx, freq, Q);
    case 'nonlinear': return createNonlinearFilter(ctx);
    default: return createLowpass(ctx, freq, Q);
  }
}
