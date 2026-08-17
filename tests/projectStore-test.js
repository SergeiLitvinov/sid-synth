import { createProjectStore, PROJECT_STORAGE_KEY, LEGACY_AUTOSAVE_KEY, LEGACY_TRACKS_KEY } from '../src/project/projectStore.js';
import { defaultProject } from '../src/project/defaultProject.js';

const results = document.getElementById('results');
const summary = document.getElementById('summary');
const passed = [];
const failed = [];
const pending = [];

function check(name, fn) {
  try {
    if (fn() === false) throw new Error('assertion returned false');
    passed.push(name);
    const li = document.createElement('li');
    li.textContent = `PASS  ${name}`;
    results.appendChild(li);
  } catch (err) {
    failed.push(name);
    const li = document.createElement('li');
    li.className = 'fail';
    li.textContent = `FAIL  ${name}: ${err.message}`;
    results.appendChild(li);
  }
}

function checkAsync(name, fn) {
  pending.push(Promise.resolve().then(() => fn()).then(() => {
    passed.push(name);
    const li = document.createElement('li');
    li.textContent = `PASS  ${name}`;
    results.appendChild(li);
  }, (err) => {
    failed.push(name);
    const li = document.createElement('li');
    li.className = 'fail';
    li.textContent = `FAIL  ${name}: ${err.message}`;
    results.appendChild(li);
  }));
}

function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    dump: () => Object.fromEntries(map),
    _map: map,
  };
}

function makeDoc(overrides = {}) {
  return defaultProject({
    id: 'proj_test',
    name: 'Test Project',
    tempo: 130,
    rackComponents: [{ id: 'osc1', type: 'oscillator', x: 12, y: 34, params: { n: 0, wave: 'saw' } }],
    rackConnections: [{ from: 'osc1', to: 'master', toChannel: null, outChannel: 0 }],
    tracks: [{ id: 'trk_a', name: 'A', grid: ['C4', null], rt: [], volume: 0.5 }],
    activeTrackId: 'trk_a',
    ...overrides,
  });
}

// ---- save path ------------------------------------------------------------
check('saveNow writes the captured doc under the unified key', () => {
  const storage = fakeStorage();
  let captured = null;
  const store = createProjectStore({
    storage,
    capture: () => { captured = makeDoc(); return captured; },
  });
  store.saveNow();
  const raw = storage.getItem(PROJECT_STORAGE_KEY);
  if (!raw) return false;
  const doc = JSON.parse(raw);
  return doc.id === 'proj_test' && doc.tempo === 130 && doc.tracks[0].id === 'trk_a';
});

check('capture result is what gets persisted', () => {
  const storage = fakeStorage();
  const doc = makeDoc({ name: 'Persisted Name' });
  const store = createProjectStore({ storage, capture: () => doc });
  store.saveNow();
  return JSON.parse(storage.getItem(PROJECT_STORAGE_KEY)).name === 'Persisted Name';
});

check('saveNow with no capture is a no-op', () => {
  const storage = fakeStorage();
  const store = createProjectStore({ storage });
  store.saveNow();
  return storage.getItem(PROJECT_STORAGE_KEY) === null;
});

check('readRaw returns the raw JSON string', () => {
  const storage = fakeStorage();
  const store = createProjectStore({ storage, capture: () => makeDoc() });
  store.saveNow();
  return typeof store.readRaw() === 'string' && store.readRaw().includes('"schemaVersion"');
});

checkAsync('markDirty debounces writes within debounceMs', async () => {
  const storage = fakeStorage();
  let writes = 0;
  const store = createProjectStore({
    storage,
    debounceMs: 25,
    capture: () => makeDoc(),
  });
  const origSet = storage.setItem;
  storage.setItem = (k, v) => { writes++; return origSet(k, v); };
  store.markDirty();
  store.markDirty();
  store.markDirty();
  if (writes !== 0) throw new Error('wrote before debounce window');
  await new Promise(r => setTimeout(r, 80));
  if (writes !== 1) throw new Error('expected exactly 1 debounced write, got ' + writes);
  return JSON.parse(storage.getItem(PROJECT_STORAGE_KEY)).id === 'proj_test';
});

// ---- restore path ---------------------------------------------------------
check('restore applies the stored project and returns it', () => {
  const storage = fakeStorage({ [PROJECT_STORAGE_KEY]: JSON.stringify(makeDoc()) });
  let applied = null;
  const store = createProjectStore({ storage, apply: (p) => { applied = p; } });
  const got = store.restore();
  return applied && got && applied.id === 'proj_test' && applied.tracks[0].volume === 0.5;
});

check('restore returns null when nothing is stored and apply is skipped', () => {
  const storage = fakeStorage();
  let calls = 0;
  const store = createProjectStore({ storage, apply: () => { calls++; } });
  const got = store.restore();
  return got === null && calls === 0;
});

check('restore migrates legacy autosave + tracks keys into the unified key', () => {
  const storage = fakeStorage({
    [LEGACY_AUTOSAVE_KEY]: JSON.stringify({
      components: [{ id: 'osc1', type: 'oscillator', x: 5, y: 6, params: { n: 0, wave: 'sine' } }],
      connections: [{ from: 'osc1', to: 'master', toChannel: null, outChannel: 0 }],
    }),
    [LEGACY_TRACKS_KEY]: JSON.stringify({
      bpm: 140,
      tracks: [{ id: 'trk_l', name: 'Legacy', grid: ['C4', null], rt: [], volume: 0.8 }],
      activeTrackId: 'trk_l',
    }),
  });
  let applied = null;
  const store = createProjectStore({ storage, apply: (p) => { applied = p; } });
  const got = store.restore();
  const migrated = JSON.parse(storage.getItem(PROJECT_STORAGE_KEY));
  return applied && got
    && applied.tempo === 140
    && applied.rack.components[0].type === 'oscillator'
    && applied.tracks[0].id === 'trk_l'
    && applied.activeTrackId === 'trk_l'
    && migrated.schemaVersion === 1
    && storage.getItem(LEGACY_AUTOSAVE_KEY) === null
    && storage.getItem(LEGACY_TRACKS_KEY) === null;
});

check('restore migrates tracks-only legacy data (no autosave rack)', () => {
  const storage = fakeStorage({
    [LEGACY_TRACKS_KEY]: JSON.stringify({ bpm: 100, tracks: [{ id: 'trk_x', name: 'X' }], activeTrackId: 'trk_x' }),
  });
  let applied = null;
  const store = createProjectStore({ storage, apply: (p) => { applied = p; } });
  store.restore();
  return applied && applied.rack.components.length === 0 && applied.tracks[0].id === 'trk_x';
});

check('unified key takes priority over legacy keys', () => {
  const storage = fakeStorage({
    [PROJECT_STORAGE_KEY]: JSON.stringify(makeDoc({ id: 'proj_new', name: 'New' })),
    [LEGACY_AUTOSAVE_KEY]: JSON.stringify({ components: [{ id: 'old', type: 'oscillator' }], connections: [] }),
    [LEGACY_TRACKS_KEY]: JSON.stringify({ bpm: 60, tracks: [], activeTrackId: null }),
  });
  let applied = null;
  const store = createProjectStore({ storage, apply: (p) => { applied = p; } });
  const got = store.restore();
  return got.id === 'proj_new' && applied.name === 'New' && storage.getItem(LEGACY_AUTOSAVE_KEY) !== null;
});

check('clear removes only the unified key', () => {
  const storage = fakeStorage({ [PROJECT_STORAGE_KEY]: JSON.stringify(makeDoc()) });
  const store = createProjectStore({ storage });
  store.saveNow();
  store.clear();
  return storage.getItem(PROJECT_STORAGE_KEY) === null;
});

Promise.all(pending).then(() => {
  summary.textContent = `${passed.length} passed, ${failed.length} failed`;
  if (failed.length) summary.className = 'fail';
  window.__testResults = { passed: passed.length, failed: failed.length };
});
