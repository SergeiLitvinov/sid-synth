import {
  hashBuffer, normalizeAsset, collectReferencedHashes, createAssetStore,
  computePeaks, computePeaksStereo, downsamplePeaks,
  sniffAudioMime, isSupportedAudioFile, importAudioFile,
} from '../src/audio/index.js';

const results = document.getElementById('results');
const summary = document.getElementById('summary');
const passed = [];
const failed = [];
const queue = [];

// Async-capable check: hashing, IndexedDB and decode are all async, so tests
// queue up and run sequentially, then the summary lands in the DOM.
function check(name, fn) {
  queue.push({ name, fn });
}

function hexOf(str) {
  return hashBuffer(new TextEncoder().encode(str));
}

// Tiny synthetic 16-bit mono WAV for the import pipeline (no fixture files).
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

const stubCtx = {
  decodeAudioData: async () => ({ sampleRate: 44100, numberOfChannels: 2, duration: 1.5 }),
};

// ---- hashing -------------------------------------------------------------
check('hashBuffer empty input matches SHA-256 known vector', async () => {
  return (await hexOf('')) === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
});
check('hashBuffer abc matches SHA-256 known vector', async () => {
  return (await hexOf('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
});
check('hashBuffer returns 64-char lowercase hex', async () => {
  const h = await hexOf('kick');
  return h.length === 64 && /^[0-9a-f]{64}$/.test(h);
});
check('hashBuffer distinguishes inputs and accepts views', async () => {
  const a = await hashBuffer(new Uint8Array([1, 2, 3]));
  const b = await hashBuffer(new Uint8Array([1, 2, 4]));
  const c = await hashBuffer(new Uint8Array([1, 2, 3]));
  return a !== b && a === c;
});

// ---- peaks ---------------------------------------------------------------
check('computePeaks constant signal fills every bucket', () => {
  const data = new Float32Array(100).fill(0.5);
  const peaks = computePeaks(data, 10);
  return peaks.length === 10 && [...peaks].every(v => Math.abs(v - 0.5) < 1e-9);
});
check('computePeaks takes max-abs per bucket incl. negatives', () => {
  const peaks = computePeaks(new Float32Array([-0.2, 0.8, -0.9, 0.1]), 2);
  return peaks.length === 2 && Math.abs(peaks[0] - 0.8) < 1e-6 && Math.abs(peaks[1] - 0.9) < 1e-6;
});
check('computePeaks empty input yields zeros', () => {
  const peaks = computePeaks(new Float32Array(0), 8);
  return peaks.length === 8 && [...peaks].every(v => v === 0);
});
check('computePeaks non-positive count yields empty', () => {
  return computePeaks(new Float32Array([0.5]), 0).length === 0;
});
check('computePeaksStereo takes max across channels', () => {
  const peaks = computePeaksStereo([new Float32Array([0.3, 0.3]), new Float32Array([0.7, 0.1])], 2);
  return peaks.length === 2 && Math.abs(peaks[0] - 0.7) < 1e-6 && Math.abs(peaks[1] - 0.3) < 1e-6;
});
check('downsamplePeaks max-of-groups and copy on wide target', () => {
  const down = downsamplePeaks(new Float32Array([0.1, 0.9, 0.4, 0.2]), 2);
  const copy = downsamplePeaks(new Float32Array([0.5, 0.6]), 8);
  return down.length === 2 && Math.abs(down[0] - 0.9) < 1e-6 && Math.abs(down[1] - 0.4) < 1e-6
    && copy.length === 2 && Math.abs(copy[1] - 0.6) < 1e-6;
});

// ---- mime sniffing --------------------------------------------------------
check('sniffAudioMime maps extensions', () => {
  return sniffAudioMime({ name: 'k.WAV' }) === 'audio/wav'
    && sniffAudioMime({ name: 'song.mp3' }) === 'audio/mpeg'
    && sniffAudioMime({ name: 'loop.ogg' }) === 'audio/ogg'
    && sniffAudioMime({ name: 'take.flac' }) === 'audio/flac'
    && sniffAudioMime({ name: 'old.aiff' }) === 'audio/aiff';
});
check('sniffAudioMime falls back to file.type, else empty', () => {
  return sniffAudioMime({ name: 'blob', type: 'audio/mpeg' }) === 'audio/mpeg'
    && sniffAudioMime({ name: 'blob', type: '' }) === ''
    && sniffAudioMime(null) === '';
});
check('isSupportedAudioFile gates by sniffed mime', () => {
  return isSupportedAudioFile({ name: 'a.wav' }) === true
    && isSupportedAudioFile({ name: 'notes.txt', type: 'text/plain' }) === false;
});

// ---- asset metadata -------------------------------------------------------
check('normalizeAsset fills defaults and strips blob', () => {
  const a = normalizeAsset({ hash: 'ab', blob: new Blob(['x']), peaks: new Float32Array([1]) });
  return a.hash === 'ab' && a.name === 'audio' && a.size === 0
    && !('blob' in a) && !('peaks' in a) && typeof a.createdAt === 'string';
});
check('normalizeAsset keeps valid fields', () => {
  const a = normalizeAsset({ hash: 'h', name: 'k.wav', mime: 'audio/wav', size: 44, sampleRate: 44100, channels: 2, duration: 1.5 });
  return a.name === 'k.wav' && a.sampleRate === 44100 && a.channels === 2 && a.duration === 1.5;
});
check('collectReferencedHashes scans manifest and clip audio refs', () => {
  const hashes = collectReferencedHashes({
    assets: [{ hash: 'm1' }, { name: 'no-hash' }],
    tracks: [{ clips: [{ audio: { hash: 'c1' } }, { events: [] }] }],
  });
  return hashes.length === 2 && hashes.includes('m1') && hashes.includes('c1');
});

// ---- IndexedDB store -------------------------------------------------------
const TEST_DB = 'sid-synth-assets-test';

async function freshStore() {
  const store = createAssetStore({ dbName: TEST_DB });
  await store.open();
  await store.clear();
  return store;
}

function dropTestDb() {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve();
    const req = indexedDB.deleteDatabase(TEST_DB);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

check('store put/get round-trips record incl. blob bytes', async () => {
  const store = await freshStore();
  try {
    const bytes = new Uint8Array([10, 20, 30]);
    await store.put({ hash: 'h1', name: 'a.wav', mime: 'audio/wav', size: 3, sampleRate: 8000, channels: 1, duration: 0.1, createdAt: 't', blob: new Blob([bytes]) });
    const got = await store.get('h1');
    const back = new Uint8Array(await got.blob.arrayBuffer());
    return got.name === 'a.wav' && back.length === 3 && back[1] === 20;
  } finally {
    store.close();
  }
});
check('store has/get miss on unknown hash', async () => {
  const store = await freshStore();
  try {
    return (await store.has('nope')) === false && (await store.get('nope')) === null;
  } finally {
    store.close();
  }
});
check('store list strips blobs', async () => {
  const store = await freshStore();
  try {
    await store.put({ hash: 'h2', name: 'b.wav', mime: 'audio/wav', size: 1, sampleRate: 8000, channels: 1, duration: 0.1, createdAt: 't', blob: new Blob(['x']) });
    const list = await store.list();
    return list.length === 1 && list[0].hash === 'h2' && !('blob' in list[0]);
  } finally {
    store.close();
  }
});
check('store remove deletes', async () => {
  const store = await freshStore();
  try {
    await store.put({ hash: 'h3', name: 'c.wav', mime: 'audio/wav', size: 1, sampleRate: 8000, channels: 1, duration: 0.1, createdAt: 't', blob: new Blob(['x']) });
    await store.remove('h3');
    return (await store.has('h3')) === false;
  } finally {
    store.close();
  }
});
check('store gc deletes only orphans and returns them', async () => {
  const store = await freshStore();
  try {
    const rec = h => ({ hash: h, name: h, mime: 'audio/wav', size: 1, sampleRate: 8000, channels: 1, duration: 0.1, createdAt: 't', blob: new Blob(['x']) });
    await store.put(rec('keep'));
    await store.put(rec('drop'));
    const dead = await store.gc(new Set(['keep']));
    return dead.length === 1 && dead[0] === 'drop'
      && (await store.has('keep')) === true && (await store.has('drop')) === false;
  } finally {
    store.close();
  }
});
check('store put rejects records without hash or blob', async () => {
  const store = await freshStore();
  try {
    let n = 0;
    try { await store.put({ name: 'x' }); } catch (e) { n++; }
    try { await store.put({ hash: 'h', name: 'x' }); } catch (e) { n++; }
    return n === 2;
  } finally {
    store.close();
  }
});

// ---- import pipeline -------------------------------------------------------
check('importAudioFile stores new asset with decoded metadata', async () => {
  const store = await freshStore();
  try {
    const buf = makeWavBytes();
    const { hash, asset, deduplicated } = await importAudioFile(stubFile('kick.wav', 'audio/wav', buf), { ctx: stubCtx, store });
    return deduplicated === false && typeof hash === 'string' && hash.length === 64
      && asset.name === 'kick.wav' && asset.sampleRate === 44100 && asset.channels === 2
      && (await store.has(hash)) === true;
  } finally {
    store.close();
  }
});
check('importAudioFile dedupes identical bytes without re-decode', async () => {
  const store = await freshStore();
  try {
    const buf = makeWavBytes();
    let decodes = 0;
    const countingCtx = { decodeAudioData: async () => { decodes++; return { sampleRate: 8000, numberOfChannels: 1, duration: 0.1 }; } };
    const first = await importAudioFile(stubFile('a.wav', 'audio/wav', buf), { ctx: countingCtx, store });
    const second = await importAudioFile(stubFile('copy.wav', 'audio/wav', buf), { ctx: countingCtx, store });
    const list = await store.list();
    return first.deduplicated === false && second.deduplicated === true
      && first.hash === second.hash && decodes === 1 && list.length === 1;
  } finally {
    store.close();
  }
});
check('importAudioFile rejects undecodable files', async () => {
  const store = await freshStore();
  try {
    const badCtx = { decodeAudioData: async () => { throw new Error('bad riff'); } };
    let threw = false;
    try {
      await importAudioFile(stubFile('bad.wav', 'audio/wav', makeWavBytes()), { ctx: badCtx, store });
    } catch (e) {
      threw = /cannot decode/.test(e.message);
    }
    return threw && (await store.list()).length === 0;
  } finally {
    store.close();
    await dropTestDb();
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
