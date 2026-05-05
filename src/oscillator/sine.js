export function createSine(ctx, freq) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  return osc;
}
