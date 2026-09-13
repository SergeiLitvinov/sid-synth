// TDD tests for comprehensive project validation (PR #1)
// Tests cover: finite numbers, valid ranges, unique IDs, cross-references, schema version

import { validateProject, validateComponent, validateTrack } from '../src/project/serialize.js';
import { defaultProject, defaultTrackData, SCHEMA_VERSION } from '../src/project/defaultProject.js';

const results = document.getElementById('results');
const summary = document.getElementById('summary');
const passed = [];
const failed = [];

function check(name, fn) {
  try {
    if (fn() === false) throw new Error('assertion returned false');
    passed.push(name);
    const li = document.createElement('li');
    li.className = 'pass';
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

// Helper to create a minimal valid project
function validProject(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'proj_test',
    name: 'Test Project',
    tempo: 120,
    rack: { components: [], connections: [] },
    tracks: [],
    markers: [],
    assets: [],
    ...overrides,
  };
}

// ===== Schema Version Validation =====
check('validateProject accepts current schemaVersion', () => {
  const p = validProject();
  return validateProject(p) === true;
});

check('validateProject rejects missing schemaVersion', () => {
  const p = validProject();
  delete p.schemaVersion;
  try { validateProject(p); return false; } catch (e) { return true; }
});

check('validateProject rejects future schemaVersion', () => {
  const p = validProject({ schemaVersion: SCHEMA_VERSION + 1 });
  try { validateProject(p); return false; } catch (e) { return true; }
});

// ===== Finite Numbers Validation =====
check('validateProject rejects NaN tempo', () => {
  const p = validProject({ tempo: NaN });
  try { validateProject(p); return false; } catch (e) { return true; }
});

check('validateProject rejects Infinity tempo', () => {
  const p = validProject({ tempo: Infinity });
  try { validateProject(p); return false; } catch (e) { return true; }
});

check('validateProject rejects negative tempo', () => {
  const p = validProject({ tempo: -60 });
  try { validateProject(p); return false; } catch (e) { return true; }
});

check('validateProject rejects zero tempo', () => {
  const p = validProject({ tempo: 0 });
  try { validateProject(p); return false; } catch (e) { return true; }
});

check('validateProject accepts valid tempo range (40-300)', () => {
  const p1 = validProject({ tempo: 40 });
  const p2 = validProject({ tempo: 300 });
  return validateProject(p1) === true && validateProject(p2) === true;
});

// ===== Component ID Uniqueness =====
check('validateProject rejects duplicate component IDs', () => {
  const p = validProject({
    rack: {
      components: [
        { id: 'osc_1', type: 'oscillator', x: 0, y: 0, params: {} },
        { id: 'osc_1', type: 'filter', x: 100, y: 0, params: {} },
      ],
      connections: [],
    },
  });
  try { validateProject(p); return false; } catch (e) { return true; }
});

check('validateProject accepts unique component IDs', () => {
  const p = validProject({
    rack: {
      components: [
        { id: 'osc_1', type: 'oscillator', x: 0, y: 0, params: {} },
        { id: 'filt_1', type: 'filter', x: 100, y: 0, params: {} },
      ],
      connections: [],
    },
  });
  return validateProject(p) === true;
});

// ===== Track ID Uniqueness =====
check('validateProject rejects duplicate track IDs', () => {
  const p = validProject({
    tracks: [
      { id: 'trk_1', clips: [] },
      { id: 'trk_1', clips: [] },
    ],
  });
  try { validateProject(p); return false; } catch (e) { return true; }
});

check('validateProject accepts unique track IDs', () => {
  const p = validProject({
    tracks: [
      { id: 'trk_1', clips: [] },
      { id: 'trk_2', clips: [] },
    ],
  });
  return validateProject(p) === true;
});

// ===== Marker ID Uniqueness =====
check('validateProject rejects duplicate marker IDs', () => {
  const p = validProject({
    markers: [
      { id: 'mrk_1', name: 'Intro', tick: 0 },
      { id: 'mrk_1', name: 'Verse', tick: 1920 },
    ],
  });
  try { validateProject(p); return false; } catch (e) { return true; }
});

// ===== Connection Reference Validation =====
check('validateProject rejects connection to non-existent component', () => {
  const p = validProject({
    rack: {
      components: [{ id: 'osc_1', type: 'oscillator', x: 0, y: 0, params: {} }],
      connections: [{ from: 'osc_1', to: 'nonexistent', toChannel: null, outChannel: 0 }],
    },
  });
  try { validateProject(p); return false; } catch (e) { return true; }
});

check('validateProject accepts connection to master', () => {
  const p = validProject({
    rack: {
      components: [{ id: 'osc_1', type: 'oscillator', x: 0, y: 0, params: {} }],
      connections: [{ from: 'osc_1', to: 'master', toChannel: null, outChannel: 0 }],
    },
  });
  return validateProject(p) === true;
});

check('validateProject accepts connection between existing components', () => {
  const p = validProject({
    rack: {
      components: [
        { id: 'osc_1', type: 'oscillator', x: 0, y: 0, params: {} },
        { id: 'filt_1', type: 'filter', x: 100, y: 0, params: {} },
      ],
      connections: [{ from: 'osc_1', to: 'filt_1', toChannel: null, outChannel: 0 }],
    },
  });
  return validateProject(p) === true;
});

// ===== Active Track Reference Validation =====
check('validateProject rejects activeTrackId pointing to non-existent track', () => {
  const p = validProject({
    tracks: [{ id: 'trk_1', clips: [] }],
    activeTrackId: 'trk_nonexistent',
  });
  try { validateProject(p); return false; } catch (e) { return true; }
});

check('validateProject accepts valid activeTrackId', () => {
  const p = validProject({
    tracks: [{ id: 'trk_1', clips: [] }],
    activeTrackId: 'trk_1',
  });
  return validateProject(p) === true;
});

check('validateProject accepts null activeTrackId', () => {
  const p = validProject({
    tracks: [],
    activeTrackId: null,
  });
  return validateProject(p) === true;
});

// ===== Clip Event Validation =====
check('validateTrack rejects clip event with NaN start', () => {
  const t = { id: 'trk_1', clips: [{ id: 'c1', start: 0, length: 1920, events: [{ note: 'C4', start: NaN, dur: 120 }] }] };
  try { validateTrack(t); return false; } catch (e) { return true; }
});

check('validateTrack rejects clip event with negative duration', () => {
  const t = { id: 'trk_1', clips: [{ id: 'c1', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: -10 }] }] };
  try { validateTrack(t); return false; } catch (e) { return true; }
});

check('validateTrack accepts valid clip events', () => {
  const t = { id: 'trk_1', clips: [{ id: 'c1', start: 0, length: 1920, events: [{ note: 'C4', start: 0, dur: 120, velocity: 100 }] }] };
  return validateTrack(t) === true;
});

// ===== Volume Range Validation =====
check('validateTrack rejects volume < 0', () => {
  const t = { id: 'trk_1', clips: [], volume: -0.5 };
  try { validateTrack(t); return false; } catch (e) { return true; }
});

check('validateTrack rejects volume > 1', () => {
  const t = { id: 'trk_1', clips: [], volume: 1.5 };
  try { validateTrack(t); return false; } catch (e) { return true; }
});

check('validateTrack accepts volume in range [0, 1]', () => {
  const t1 = { id: 'trk_1', clips: [], volume: 0 };
  const t2 = { id: 'trk_1', clips: [], volume: 1 };
  return validateTrack(t1) === true && validateTrack(t2) === true;
});

// ===== ADSR Validation =====
check('validateTrack rejects negative ADSR attack', () => {
  const t = { id: 'trk_1', clips: [], adsr: { a: -0.1, d: 0.1, s: 0.7, r: 0.1 } };
  try { validateTrack(t); return false; } catch (e) { return true; }
});

check('validateTrack rejects sustain outside [0, 1]', () => {
  const t1 = { id: 'trk_1', clips: [], adsr: { a: 0.01, d: 0.1, s: -0.5, r: 0.1 } };
  const t2 = { id: 'trk_1', clips: [], adsr: { a: 0.01, d: 0.1, s: 1.5, r: 0.1 } };
  try { validateTrack(t1); return false; } catch (e) { return true; }
  try { validateTrack(t2); return false; } catch (e) { return true; }
});

// ===== Filter Frequency Validation =====
check('validateTrack rejects negative filterFreq', () => {
  const t = { id: 'trk_1', clips: [], filterFreq: -100 };
  try { validateTrack(t); return false; } catch (e) { return true; }
});

check('validateTrack accepts valid filterFreq range (20-20000)', () => {
  const t1 = { id: 'trk_1', clips: [], filterFreq: 20 };
  const t2 = { id: 'trk_1', clips: [], filterFreq: 20000 };
  return validateTrack(t1) === true && validateTrack(t2) === true;
});

// ===== Loop Bounds Validation =====
check('validateProject rejects loopStartTicks < 0', () => {
  const p = validProject({ loopStartTicks: -100, loopEndTicks: 1920, loopEnabled: true });
  try { validateProject(p); return false; } catch (e) { return true; }
});

check('validateProject rejects loopEndTicks <= loopStartTicks', () => {
  const p = validProject({ loopStartTicks: 1920, loopEndTicks: 960, loopEnabled: true });
  try { validateProject(p); return false; } catch (e) { return true; }
});

check('validateProject accepts valid loop bounds', () => {
  const p = validProject({ loopStartTicks: 0, loopEndTicks: 3840, loopEnabled: true });
  return validateProject(p) === true;
});

// ===== Asset Hash Reference Validation =====
check('validateProject accepts clip audio reference to existing asset', () => {
  const p = validProject({
    assets: [{ hash: 'abc123', name: 'kick.wav', mime: 'audio/wav' }],
    tracks: [{
      id: 'trk_1',
      clips: [{ id: 'c1', start: 0, length: 1920, events: [], audio: { hash: 'abc123', offset: 0 } }],
    }],
  });
  return validateProject(p) === true;
});

check('validateProject rejects clip audio reference to missing asset', () => {
  const p = validProject({
    assets: [],
    tracks: [{
      id: 'trk_1',
      clips: [{ id: 'c1', start: 0, length: 1920, events: [], audio: { hash: 'missing', offset: 0 } }],
    }],
  });
  try { validateProject(p); return false; } catch (e) { return true; }
});

// ===== Insert Device ID Uniqueness per Track =====
check('validateTrack rejects duplicate insert IDs in same track', () => {
  const t = {
    id: 'trk_1',
    clips: [],
    inserts: [
      { id: 'ins_1', type: 'delay', params: {} },
      { id: 'ins_1', type: 'reverb', params: {} },
    ],
  };
  try { validateTrack(t); return false; } catch (e) { return true; }
});

check('validateTrack accepts unique insert IDs', () => {
  const t = {
    id: 'trk_1',
    clips: [],
    inserts: [
      { id: 'ins_1', type: 'delay', params: {} },
      { id: 'ins_2', type: 'reverb', params: {} },
    ],
  };
  return validateTrack(t) === true;
});

// Summary
summary.textContent = `SUMMARY: ${passed.length} passed, ${failed.length} failed`;
if (failed.length > 0) {
  summary.style.color = '#ff4444';
  summary.textContent += ` — ${failed.join(', ')}`;
} else {
  summary.style.color = '#4af74a';
}
