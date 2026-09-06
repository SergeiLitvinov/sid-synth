import { createAssetStore, hashBuffer } from '../src/audio/assetStore.js';
import { createMediaPool } from '../src/audio/mediaPool.js';

const container = document.getElementById('container');
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

const TEST_DB = 'sid-synth-assets-mp-test';
const store = createAssetStore({ dbName: TEST_DB });
let manifest = [];
let pool = null;
let ctx = null;

async function setup() {
  await store.open();
  await store.clear();
  manifest = [];
  ctx = new AudioContext();
  const el = document.createElement('div');
  container.appendChild(el);
  pool = createMediaPool({
    container: el, ctx, destination: ctx.destination, store,
    getAssets: () => manifest,
    setAssets: (a) => { manifest = a; },
  });
  await pool.refresh();
}

function teardown() {
  return new Promise(resolve => {
    try { if (pool) pool.dispose(); } catch (e) {}
    try { if (ctx) ctx.close(); } catch (e) {}
    store.close();
    if (typeof indexedDB === 'undefined') return resolve();
    const req = indexedDB.deleteDatabase(TEST_DB);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

const rows = () => [...pool.el.querySelectorAll('.mp-row')];

check('renders MEDIA POOL title', async () => {
  await setup();
  return pool.el.querySelector('.panel-title').textContent === 'MEDIA POOL';
});
check('renders IMPORT button, file input, list and status', () => {
  return !!pool.el.querySelector('#mpImport')
    && !!pool.el.querySelector('input[type=file]')
    && !!pool.el.querySelector('#mpList')
    && !!pool.el.querySelector('.mp-status');
});
check('empty manifest shows drop hint', () => {
  const empty = pool.el.querySelector('.mp-empty');
  return !!empty && /drop audio files/i.test(empty.textContent);
});
check('importFiles adds a row and manifest entry', async () => {
  const r = await pool.importFiles([stubFile('kick.wav', 'audio/wav', makeWavBytes())]);
  return r.imported === 1 && rows().length === 1
    && manifest.length === 1 && manifest[0].name === 'kick.wav'
    && /1 imported/.test(pool.getStatus());
});
check('importFiles dedupes identical bytes', async () => {
  const buf = makeWavBytes({ freq: 220 });
  await pool.importFiles([stubFile('a.wav', 'audio/wav', buf)]);
  const before = manifest.length;
  const r = await pool.importFiles([stubFile('copy.wav', 'audio/wav', buf)]);
  return r.deduplicated === 1 && r.imported === 0 && manifest.length === before
    && /already in pool/.test(pool.getStatus());
});
check('unsupported files are skipped without manifest change', async () => {
  const before = manifest.length;
  const r = await pool.importFiles([{ name: 'notes.txt', type: 'text/plain', size: 3, arrayBuffer: async () => new ArrayBuffer(3) }]);
  return r.skipped === 1 && manifest.length === before && /skipped/.test(pool.getStatus());
});
check('peaks are cached on the store record', async () => {
  const rec = await store.get(manifest[0].hash);
  return rec && Array.isArray(rec.peaks) && rec.peaks.length === 256
    && !!rows()[0].querySelector('canvas.mp-wave');
});
check('delete removes row, store record and manifest entry', async () => {
  const hash = manifest[0].hash;
  rows()[0].querySelector('.mp-del').click();
  await new Promise(res => setTimeout(res, 100));
  return rows().length === 1 && manifest.length === 1 && manifest[0].name === 'a.wav'
    && (await store.has(hash)) === false;
});
check('manifest entries missing from store render as missing', async () => {
  manifest = [{ hash: 'ghost', name: 'gone.wav', mime: 'audio/wav', size: 10, sampleRate: 8000, channels: 1, duration: 0.1 }];
  await pool.refresh();
  const row = rows()[0];
  return !!row && row.classList.contains('mp-missing') && row.querySelector('.mp-play').disabled === true;
});
check('preview toggles play state on the row button', async () => {
  manifest = [];
  await pool.refresh();
  await pool.importFiles([stubFile('hat.wav', 'audio/wav', makeWavBytes({ freq: 880 }))]);
  const hash = manifest[0].hash;
  const on = await pool.togglePreview(hash);
  const btnOn = rows()[0].querySelector('.mp-play').classList.contains('on');
  const off = await pool.togglePreview(hash);
  const btnOff = rows()[0].querySelector('.mp-play').classList.contains('on');
  return on === true && btnOn === true && off === false && btnOff === false;
});
check('missing rows expose LOCATE and REPLACE buttons', async () => {
  manifest.push({ hash: 'ghost1', name: 'gone.wav', mime: 'audio/wav', size: 10, sampleRate: 8000, channels: 1, duration: 0.1 });
  await pool.refresh();
  const row = rows().find(r => r.dataset.hash === 'ghost1');
  return !!row && row.classList.contains('mp-missing')
    && !!row.querySelector('.mp-locate') && !!row.querySelector('.mp-replace');
});
check('locateAsset relinks the same file by hash', async () => {
  const mk = () => stubFile('found.wav', 'audio/wav', makeWavBytes({ freq: 330 }));
  const hash = await hashBuffer(await mk().arrayBuffer());
  manifest.push({ hash, name: 'found.wav', mime: 'audio/wav', size: 1024, sampleRate: 8000, channels: 1, duration: 0.1 });
  await pool.refresh();
  const res = await pool.locateAsset(hash, mk());
  const row = rows().find(r => r.dataset.hash === hash);
  return res.ok === true && !row.classList.contains('mp-missing') && (await store.has(hash)) === true;
});
check('locateAsset rejects a different file', async () => {
  manifest.push({ hash: 'x', name: 'x.wav', mime: 'audio/wav', size: 8, sampleRate: 8000, channels: 1, duration: 0.1 });
  await pool.refresh();
  const res = await pool.locateAsset('x', stubFile('other.wav', 'audio/wav', makeWavBytes({ freq: 331 })));
  const row = rows().find(r => r.dataset.hash === 'x');
  return res.ok === false && res.reason === 'mismatch' && row.classList.contains('mp-missing');
});
check('replaceAsset swaps the entry and drops the orphan blob', async () => {
  manifest = [{ hash: 'old', name: 'old.wav', mime: 'audio/wav', size: 8, sampleRate: 8000, channels: 1, duration: 0.1 }];
  await pool.refresh();
  const res = await pool.replaceAsset('old', stubFile('new.wav', 'audio/wav', makeWavBytes({ freq: 550 })));
  return res.ok === true && manifest.length === 1 && manifest[0].hash === res.hash
    && manifest[0].name === 'new.wav' && rows().length === 1
    && !rows()[0].classList.contains('mp-missing') && (await store.has(res.hash)) === true;
});
check('title shows the missing count', async () => {
  const ghost = h => ({ hash: h, name: h + '.wav', mime: 'audio/wav', size: 1, sampleRate: 8000, channels: 1, duration: 0.1 });
  manifest = [ghost('m1'), ghost('m2')];
  await pool.refresh();
  const titled = pool.el.querySelector('.panel-title').textContent;
  manifest = [];
  await pool.refresh();
  const plain = pool.el.querySelector('.panel-title').textContent;
  return /2 missing/.test(titled) && plain === 'MEDIA POOL';
});
check('+CLIP forwards the asset to onAddClip', async () => {
  const seen = [];
  const el2 = document.createElement('div');
  container.appendChild(el2);
  let m2 = [];
  const pool2 = createMediaPool({
    container: el2, ctx, destination: ctx.destination, store,
    getAssets: () => m2,
    setAssets: (a) => { m2 = a; },
    onAddClip: (asset) => seen.push(asset),
  });
  await pool2.importFiles([stubFile('clip.wav', 'audio/wav', makeWavBytes({ freq: 660 }))]);
  const btn = el2.querySelector('.mp-addclip');
  if (!btn) {
    pool2.dispose();
    el2.remove();
    await teardown();
    return false;
  }
  btn.click();
  const ok = seen.length === 1 && seen[0].name === 'clip.wav' && typeof seen[0].hash === 'string';
  pool2.dispose();
  el2.remove();
  await teardown();
  return ok;
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
