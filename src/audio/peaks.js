// Waveform peak helpers (M4): pure functions over channel sample data.
// Peaks are max-absolute amplitudes per bucket, cached per asset for the
// media pool and clip waveform rendering at several levels of detail.

// Max-abs peak per bucket across one channel. Always returns exactly
// `numPeaks` entries (empty input yields zeros, never NaN).
export function computePeaks(channelData, numPeaks) {
  const n = Math.floor(numPeaks);
  if (!(n > 0)) return new Float32Array(0);
  const out = new Float32Array(n);
  const len = channelData ? channelData.length : 0;
  if (!(len > 0)) return out;
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * len) / n);
    const to = Math.max(from + 1, Math.floor(((i + 1) * len) / n));
    let peak = 0;
    for (let s = from; s < to; s++) {
      const v = Math.abs(channelData[s]);
      if (v > peak) peak = v;
    }
    out[i] = peak;
  }
  return out;
}

// Max across all channels per bucket, so stereo waveforms show the louder
// side. Single-channel input behaves like computePeaks.
export function computePeaksStereo(channels, numPeaks) {
  const list = Array.isArray(channels) ? channels.filter(c => c && c.length > 0) : [];
  const n = Math.floor(numPeaks);
  if (!(n > 0)) return new Float32Array(0);
  if (!list.length) return new Float32Array(n);
  const per = list.map(c => computePeaks(c, n));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (let p = 0; p < per.length; p++) {
      if (per[p][i] > peak) peak = per[p][i];
    }
    out[i] = peak;
  }
  return out;
}

// Coarser level of detail from a finer peak array: max of each group.
// `target` larger than the input returns a copy unchanged.
export function downsamplePeaks(peaks, target) {
  const t = Math.floor(target);
  const src = peaks && typeof peaks.length === 'number' ? peaks : [];
  if (!(t > 0) || t >= src.length) return Float32Array.from(src);
  return computePeaks(src, t);
}
