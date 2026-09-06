// Waveform canvas rendering (M4): draws max-abs peak arrays as centered
// bars. Shared by the media pool sparklines and the arranger clip blocks.
export function drawWaveform(canvas, peaks, { color = '#4af74a', background = '#0a0f0a' } = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const w = canvas.width;
  const h = canvas.height;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, w, h);
  g.fillStyle = background;
  g.fillRect(0, 0, w, h);
  if (!peaks || !peaks.length) return;
  g.fillStyle = color;
  const n = peaks.length;
  const bw = Math.max(1, w / n);
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, Math.min(1, peaks[i]));
    const bh = Math.max(1, v * h);
    g.fillRect(i * bw, (h - bh) / 2, Math.max(1, bw - 0.5), bh);
  }
}
