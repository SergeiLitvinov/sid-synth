export function createLowpass(ctx, freq = 2000, Q = 1) {
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  f.Q.value = Q;
  return f;
}
