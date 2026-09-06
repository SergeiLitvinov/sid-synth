import { createAssetStore } from '../src/audio/assetStore.js';
import { importAudioFile } from '../src/audio/audioImport.js';
import { projectSampleRate, decodeAtSampleRate, resampleBuffer } from '../src/audio/resample.js';

const results = document.getElementById('results');
const summary = document.getElementById('summary');
const passed = [];
const failed = [];
const queue = [];

function check(name, fn) {
  queue.push({ name, fn });
}

function makeWavBytes({ sampleRate = 8000, freq = 440, seconds = 0.1 } = {}) {
  const n = Math.max(1, Math.floor(sampleRate * seconds));
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  wstr(8, 'WAVE');
  wstr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  wstr(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 2, Math.floor(32767 * 0.5 * Math.sin((2 * Math.PI * freq * i) / sampleRate)), true);
  }
  return buf;
}

function stubFile(name, type, buf) {
  return { name, type, size: buf.byteLength, arrayBuffer: async () => buf.slice(0) };
}

const TEST_DB = 'sid-synth-assets-rs-test';

check('projectSampleRate reads the context rate and rejects junk', () => {
  let threw = false;
  try { projectSampleRate(null); } catch (e) { threw = true; }
  return projectSampleRate({ sampleRate: 44100 }) === 44100 && threw;
});
check('decodeAtSampleRate lands a wav at the target rate', async () => {
  const decoded = await decodeAtSampleRate(makeWavBytes(), 48000);
  return decoded.sampleRate === 48000 && Math.abs(decoded.duration - 0.1) < 1e-3;
});
check('decodeAtSampleRate rejects bad rate and bad input', async () => {
  let n = 0;
  try { await decodeAtSampleRate(makeWavBytes(), 0); } catch (e) { n++; }
  try { await decodeAtSampleRate(null, 44100); } catch (e) { n++; }
  return n === 2;
});
check('resampleBuffer returns same-rate input untouched', async () => {
  const ctx = new AudioContext();
  try {
    const buf = ctx.createBuffer(1, 800, 16000);
    return (await resampleBuffer(buf, 16000)) === buf;
  } finally {
    try { await ctx.close(); } catch (e) {}
  }
});
check('resampleBuffer scales length and keeps duration', async () => {
  const src = await decodeAtSampleRate(makeWavBytes(), 8000);
  const out = await resampleBuffer(src, 16000);
  return out.sampleRate === 16000 && Math.abs(out.length - 1600) <= 4
    && Math.abs(out.duration - 0.1) < 1e-3;
});
check('resampleBuffer preserves channel count', async () => {
  const ctx = new AudioContext();
  try {
    const stereo = ctx.createBuffer(2, 800, 8000);
    stereo.getChannelData(0).fill(0.5);
    stereo.getChannelData(1).fill(-0.25);
    const out = await resampleBuffer(stereo, 16000);
    return out.numberOfChannels === 2 && out.length === 1600
      && out.getChannelData(0)[0] > 0.4 && out.getChannelData(1)[0] < -0.2;
  } finally {
    try { await ctx.close(); } catch (e) {}
  }
});
check('resampleBuffer rejects invalid input', async () => {
  let n = 0;
  try { await resampleBuffer(null, 44100); } catch (e) { n++; }
  try { await resampleBuffer({ sampleRate: 8000 }, 0); } catch (e) { n++; }
  return n === 2;
});
check('importAudioFile targetSampleRate stores metadata at target rate', async () => {
  const store = createAssetStore({ dbName: TEST_DB });
  try {
    await store.open();
    await store.clear();
    const { asset } = await importAudioFile(
      stubFile('take.wav', 'audio/wav', makeWavBytes()), { store, targetSampleRate: 22050 }
    );
    return asset.sampleRate === 22050;
  } finally {
    store.close();
  }
});
check('importAudioFile without target keeps context-rate behavior', async () => {
  const store = createAssetStore({ dbName: TEST_DB });
  try {
    await store.open();
    await store.clear();
    const stubCtx = { decodeAudioData: async () => ({ sampleRate: 44100, numberOfChannels: 1, duration: 0.2 }) };
    const { asset } = await importAudioFile(
      stubFile('old.wav', 'audio/wav', makeWavBytes()), { ctx: stubCtx, store }
    );
    const done = asset.sampleRate === 44100;
    store.close();
    await new Promise(resolve => {
      const req = indexedDB.deleteDatabase(TEST_DB);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    return done;
  } catch (e) {
    store.close();
    throw e;
  }
});

(async () => {
  for (const t of queue) {
    try {
      const r = await t.fn();
      if (r === false) throw new Error('assertion returned false');
      passed.push(t.name);
      const li = document.createElement('li');
      li.textContent = 'PASS  ' + t.name;
      results.appendChild(li);
    } catch (err) {
      failed.push(t.name);
      const li = document.createElement('li');
      li.className = 'fail';
      li.textContent = 'FAIL  ' + t.name + ': ' + err.message;
      results.appendChild(li);
    }
  }
  summary.textContent = 'SUMMARY: ' + passed.length + ' passed, ' + failed.length + ' failed';
  if (failed.length > 0) {
    summary.style.color = '#ff4444';
    summary.textContent += ' — ' + failed.join(', ');
  }
})();
