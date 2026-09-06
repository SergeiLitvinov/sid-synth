import { computePeaksStereo } from './peaks.js';

// Async multi-level peak computation (M4): channel data is copied into the
// peaks worker so long files never block the UI thread. Falls back to the
// synchronous implementation when workers are unavailable or fail — the
// result shape is identical either way: { [buckets]: number[] }.
let worker = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (workerFailed || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./peaksWorker.js', import.meta.url));
  } catch (e) {
    workerFailed = true;
    return null;
  }
  worker.onmessage = (e) => {
    const { id, ok, peaks, error } = e.data || {};
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (ok) entry.resolve(peaks);
    else entry.reject(new Error(error || 'peaks worker failed'));
  };
  worker.onerror = () => {
    workerFailed = true;
    pending.forEach(entry => entry.reject(new Error('peaks worker error')));
    pending.clear();
    try { worker.terminate(); } catch (e) {}
    worker = null;
  };
  return worker;
}

function emptyLevels(levels) {
  const out = {};
  levels.forEach(l => { out[l] = new Array(l).fill(0); });
  return out;
}

export async function computePeaksAsync(channels, levels = [256], { useWorker = true } = {}) {
  const lv = (Array.isArray(levels) ? levels : []).map(n => Math.floor(n)).filter(n => n > 0);
  if (!lv.length) return {};
  const list = (Array.isArray(channels) ? channels : [channels]).filter(c => c && c.length > 0);
  if (!list.length) return emptyLevels(lv);
  const w = useWorker ? getWorker() : null;
  if (!w) {
    const out = {};
    lv.forEach(l => { out[l] = Array.from(computePeaksStereo(list, l)); });
    return out;
  }
  const copies = list.map(c => Float32Array.from(c));
  const id = nextId++;
  const transfer = copies.map(c => c.buffer);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      w.postMessage({ id, channels: copies, levels: lv }, transfer);
    } catch (e) {
      pending.delete(id);
      reject(e);
    }
  });
}
