export function createTriangle(ctx, freq) {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  return osc;
}
