export function createBandpass(ctx, freq = 2000, Q = 1) {
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = Q;
  return f;
}
