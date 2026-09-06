// Waveform peak worker (M4): computes max-absolute peaks at several levels
// of detail off the main thread. Classic (non-module) worker with no imports
// so it loads anywhere the app is served from. Channel buffers arrive by
// transfer — callers must pass copies, never live AudioBuffer views.
function bucketPeaks(data, len, buckets) {
  const out = new Array(buckets).fill(0);
  if (!(len > 0)) return out;
  for (let i = 0; i < buckets; i++) {
    const from = Math.floor((i * len) / buckets);
    const to = Math.max(from + 1, Math.floor(((i + 1) * len) / buckets));
    let peak = 0;
    for (let s = from; s < to; s++) {
      const v = data[s] < 0 ? -data[s] : data[s];
      if (v > peak) peak = v;
    }
    out[i] = peak;
  }
  return out;
}

self.onmessage = (e) => {
  const { id, channels, levels } = e.data || {};
  try {
    if (!Array.isArray(channels) || !channels.length) throw new Error('peaksWorker: no channels');
    const lv = (Array.isArray(levels) ? levels : []).map(n => Math.floor(n)).filter(n => n > 0);
    if (!lv.length) throw new Error('peaksWorker: no levels');
    const len = channels[0].length;
    const peaks = {};
    lv.forEach(l => {
      const per = channels.map(ch => bucketPeaks(ch, len, l));
      const merged = new Array(l).fill(0);
      for (let i = 0; i < l; i++) {
        let peak = 0;
        for (let c = 0; c < per.length; c++) {
          if (per[c][i] > peak) peak = per[c][i];
        }
        merged[i] = peak;
      }
      peaks[l] = merged;
    });
    self.postMessage({ id, ok: true, peaks });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err && err.message ? err.message : 'peaksWorker failed' });
  }
};
