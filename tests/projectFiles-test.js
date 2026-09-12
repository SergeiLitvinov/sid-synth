import { exportBundle, importBundle, sanitizeFileName, BUNDLE_KIND } from '../src/project/projectFiles.js';
import { createAssetStore, hashBuffer } from '../src/audio/assetStore.js';
import { defaultProject } from '../src/project/defaultProject.js';
import { parseProject } from '../src/project/serialize.js';

const results = document.getElementById('results');
const summary = document.getElementById('summary');
const passed = [];
const failed = [];
const queue = [];

function check(name, fn) {
  queue.push({ name, fn });
}

function deleteDb(name) {
  return new Promise(resolve => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch (e) { resolve(); }
  });
}

function wavBytes(len = 256) {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = (i * 7) & 255;
  return out;
}

async function makeStore(name) {
  const store = createAssetStore({ dbName: name });
  await store.open();
  await store.clear();
  return store;
}

function makeProject(hash) {
  return defaultProject({
    name: 'Bundle Test',
    tempo: 128,
    tracks: [{
      id: 't1', name: 'T1',
      clips: [{
        id: 'c1', start: 0, length: 1920,
        events: [{ note: 'C4', start: 0, dur: 120, velocity: 90 }],
        audio: { hash },
      }],
    }],
    assets: [{ hash, name: 'take.wav', mime: 'audio/wav', size: 256, sampleRate: 44100, channels: 1, duration: 0.1 }],
  });
}

check('bundle round-trips the song plus audio bytes', async () => {
  const storeA = await makeStore('sid-synth-assets-bundle-a');
  const bytes = wavBytes();
  const blob = new Blob([bytes], { type: 'audio/wav' });
  const hash = await hashBuffer(bytes);
  await storeA.put({ hash, blob, name: 'take.wav', mime: 'audio/wav', size: bytes.length });
  let ok = false;
  try {
    // One source doc: createdAt/modifiedAt carry millisecond timestamps,
    // so the expectation must parse this exact object, not a fresh twin.
    const srcDoc = makeProject(hash);
    const bundle = await exportBundle({ project: srcDoc, store: storeA });
    if (bundle.kind !== BUNDLE_KIND || bundle.media.length !== 1 || bundle.media[0].hash !== hash) return false;
    // JSON-serializable (this is what actually travels between profiles).
    const text = JSON.stringify(bundle);
    const storeB = await makeStore('sid-synth-assets-bundle-b');
    try {
      const { project, imported, skipped } = await importBundle(text, { store: storeB });
      const sameDoc = JSON.stringify(project) === JSON.stringify(parseProject(srcDoc));
      const back = new Uint8Array(await (await storeB.getBlob(hash)).arrayBuffer());
      const sameBytes = back.length === bytes.length && back.every((v, i) => v === bytes[i]);
      ok = sameDoc && sameBytes && imported.join() === hash && skipped.length === 0;
    } finally {
      storeB.close();
      await deleteDb('sid-synth-assets-bundle-b');
    }
  } finally {
    storeA.close();
    await deleteDb('sid-synth-assets-bundle-a');
  }
  return ok;
});

check('missing blobs are listed, not fatal', async () => {
  const store = await makeStore('sid-synth-assets-bundle-c');
  let ok = false;
  try {
    const bundle = await exportBundle({ project: makeProject('deadbeef'), store });
    ok = bundle.media.length === 0 && (bundle.mediaMissing || []).join() === 'deadbeef';
    const res = await importBundle(bundle, { store });
    ok = ok && res.imported.length === 0 && res.skipped.length === 0 && res.project.name === 'Bundle Test';
  } finally {
    store.close();
    await deleteDb('sid-synth-assets-bundle-c');
  }
  return ok;
});

check('tampered media is skipped and never stored', async () => {
  const store = await makeStore('sid-synth-assets-bundle-d');
  let ok = false;
  try {
    const bytes = wavBytes();
    const hash = await hashBuffer(bytes);
    const bundle = await exportBundle({
      project: makeProject(hash),
      store: { getBlob: async () => new Blob([bytes], { type: 'audio/wav' }) },
    });
    bundle.media[0].data = btoa('forged-bytes');
    const res = await importBundle(bundle, { store });
    ok = res.skipped.length === 1 && res.skipped[0].reason === 'hash mismatch'
      && res.imported.length === 0 && (await store.has(hash)) === false;
  } finally {
    store.close();
    await deleteDb('sid-synth-assets-bundle-d');
  }
  return ok;
});

check('malformed media entries are skipped with a reason', async () => {
  const res = await importBundle({
    kind: BUNDLE_KIND, bundleVersion: 1, project: defaultProject(), media: [{ hash: 'abc' }, null, 'junk'],
  });
  return res.skipped.length === 3 && res.imported.length === 0;
});

check('invalid bundles throw clear errors', async () => {
  const cases = ['not json', '{"kind":"nope"}', '{"kind":"sid-synth-bundle","bundleVersion":999,"project":{}}', '[]', 'null'];
  for (const c of cases) {
    let threw = false;
    try { await importBundle(c, {}); } catch (e) { threw = true; }
    if (!threw) return false;
  }
  // An empty object is a benign empty project, not an error.
  const empty = await importBundle('{}', {});
  return empty.project.name === 'Untitled' && empty.imported.length === 0;
});

check('a raw project document imports without media', async () => {
  const res = await importBundle(defaultProject({ name: 'Raw' }), {});
  return res.project.name === 'Raw' && res.imported.length === 0 && res.skipped.length === 0;
});

check('sanitizeFileName strips illegal characters', () => {
  return sanitizeFileName('a/b\\c:d*e?f"g<h>i|j#k%l') === 'a_b_c_d_e_f_g_h_i_j_k_l'
    && sanitizeFileName('') === 'SID Project';
});

check('exportBundle without a project throws', async () => {
  let threw = false;
  try { await exportBundle({}); } catch (e) { threw = true; }
  return threw;
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
