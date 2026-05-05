export function createSquare(ctx, freq) {
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = freq;
  return osc;
}
