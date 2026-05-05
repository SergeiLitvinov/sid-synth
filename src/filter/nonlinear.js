export function createNonlinearFilter(ctx) {
  const waveShaper = ctx.createWaveShaper();
  waveShaper.curve = makeDistortionCurve(1.5);
  waveShaper.oversample = '4x';
  return waveShaper;
}

function makeDistortionCurve(amount) {
  const k = amount;
  const n = 44100;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}
