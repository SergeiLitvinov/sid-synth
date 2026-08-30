import { SCHEMA_VERSION, defaultProject, defaultTrackData, emptyGrid } from '../src/project/defaultProject.js';
import { serializeProject, serializeProjectJson, parseProject, roundTrip, validateProject, validateTrack, validateComponent, normalizeCell } from '../src/project/serialize.js';
import { migrateProject, fromLegacy } from '../src/project/migrate.js';

const results = document.getElementById('results');
const summary = document.getElementById('summary');
const passed = [];
const failed = [];

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

// Minimal live-app state shape used by serializeProject.
function fixtureState() {
  return {
    components: {
      oscillator_1: { type: 'oscillator', element: { style: { left: '120px', top: '40px' } }, waveform: 'square', frequency: 110, isOn: true, id: 1 },
      filter_1: { type: 'filter', element: { style: { left: '300px', top: '40px' } }, filterType: 'lowpass', frequency: 1200, Q: 1 },
    },
    connections: [
      { from: 'oscillator_1', to: 'filter_1', toChannel: null, outChannel: 0 },
      { from: 'filter_1', to: 'master', toChannel: null, outChannel: 0 },
    ],
    captureParams: (comp) => {
      switch (comp.type) {
        case 'oscillator': return { wave: comp.waveform, freq: comp.frequency, on: comp.isOn, n: comp.id };
        case 'filter': return { type: comp.filterType, freq: comp.frequency, q: comp.Q };
        default: return {};
      }
    },
    tracks: [defaultTrackData({ id: 'trk_1', grid: [{ note: 'C4', dur: 1 }, null] })],
    markers: [
      { id: 'mrk_1', name: 'Intro', tick: 0 },
      { id: 'mrk_2', name: 'Verse', tick: 1920 },
    ],
    tempo: 132,
    activeTrackId: 'trk_1',
    id: 'proj_fixture',
    name: 'Fixture',
  };
}

check('defaultProject has schemaVersion and empty rack/tracks', () => {
  const p = defaultProject();
  return p.schemaVersion === SCHEMA_VERSION
    && Array.isArray(p.rack.components) && p.rack.components.length === 0
    && Array.isArray(p.rack.connections) && p.rack.connections.length === 0
    && Array.isArray(p.tracks) && p.tracks.length === 0
    && p.activeTrackId === null && p.tempo === 120 && typeof p.id === 'string';
});

check('serializeProject builds a versioned doc from live state', () => {
  const p = serializeProject(fixtureState());
  if (p.schemaVersion !== SCHEMA_VERSION) return false;
  if (p.rack.components.length !== 2) return false;
  const osc = p.rack.components.find(c => c.id === 'oscillator_1');
  return osc && osc.type === 'oscillator' && osc.x === 120 && osc.y === 40
    && osc.params.wave === 'square' && osc.params.freq === 110;
});

check('serializeProject strips non-serializable fields from tracks', () => {
  const st = fixtureState();
  st.tracks = [{
    ...defaultTrackData({ id: 'trk_1' }),
    voice: { dispose() {} },       // live-only field that must not leak
    element: document.createElement('div'),
  }];
  const p = serializeProject(st);
  const t = p.tracks[0];
  return t && !('voice' in t) && !('element' in t) && t.grid.length === 16;
});

check('connections serialize with toChannel/outChannel', () => {
  const st = fixtureState();
  st.connections.push({ from: 'oscillator_1', to: 'filter_1', toChannel: 2, outChannel: 1 });
  const p = serializeProject(st);
  const c = p.rack.connections.find(c => c.toChannel === 2);
  return !!c && c.from === 'oscillator_1' && c.outChannel === 1;
});

check('mod connections are marked', () => {
  const st = fixtureState();
  st.connections.push({ from: 'lfo_1', to: 'oscillator_1', mod: true });
  const p = serializeProject(st);
  return p.rack.connections.some(c => c.mod === true);
});

check('serializeProjectJson round-trips to identical structure', () => {
  const original = serializeProject(fixtureState());
  const json = serializeProjectJson(fixtureState());
  const parsed = parseProject(json);
  return JSON.stringify(parsed) === JSON.stringify(original);
});

check('roundTrip preserves grid cells and rt events', () => {
  const st = fixtureState();
  st.tracks = [defaultTrackData({
    id: 'trk_1',
    grid: [{ note: 'A3', dur: 4 }, null, { note: 'E4', dur: 2 }],
    rt: [{ note: 'C4', start: 0.5, dur: 0.25 }],
  })];
  const p = serializeProject(st);
  const back = roundTrip(p);
  return JSON.stringify(back) === JSON.stringify(p);
});

check('roundTrip preserves MIDI clips', () => {
  const st = fixtureState();
  st.tracks = [defaultTrackData({
    id: 'trk_1',
    clips: [
      { id: 'clip_1', name: 'Intro', color: '#ff55ff', start: 0, length: 1920, events: [] },
      { id: 'clip_2', name: 'Verse', start: 1920, length: 1920, events: [] },
    ],
  })];
  const p = serializeProject(st);
  const back = roundTrip(p);
  const clips = back.tracks[0].clips;
  return clips.length === 2
    && clips[0].id === 'clip_1' && clips[0].name === 'Intro'
    && clips[0].start === 0 && clips[0].length === 1920
    && clips[0].color === '#ff55ff'
    && clips[1].start === 1920;
});

check('parseProject normalizes missing/partial clip fields', () => {
  const raw = {
    schemaVersion: 1, name: 'x', tempo: 120,
    rack: { components: [], connections: [] },
    tracks: [{ id: 'trk_1', grid: [], rt: [], clips: [{ name: 'OnlyName' }] }],
  };
  const p = parseProject(raw);
  const c = p.tracks[0].clips[0];
  return c && typeof c.id === 'string' && c.start === 0 && c.length === 1920 && Array.isArray(c.events);
});

check('parseProject normalizes legacy string grid cells', () => {
  const raw = { schemaVersion: 1, name: 'x', tempo: 120, rack: { components: [], connections: [] }, tracks: [defaultTrackData({ id: 'trk_1', grid: ['C4', null] })] };
  const p = parseProject(raw);
  return p.tracks[0].grid[0] && p.tracks[0].grid[0].note === 'C4' && p.tracks[0].grid[0].dur === 1;
});

check('normalizeCell handles string, object, and null', () => {
  return normalizeCell('E4').note === 'E4'
    && normalizeCell({ note: 'G3', dur: 3 }).dur === 3
    && normalizeCell(null) === null
    && normalizeCell({ note: 'C4', dur: 0 }).dur === 1;
});

check('parseProject fills missing defaults without throwing', () => {
  const raw = { tracks: [{ id: 'trk_1' }] };
  const p = parseProject(raw);
  return p.schemaVersion === SCHEMA_VERSION
    && p.name === 'Untitled'
    && p.tempo === 120
    && Array.isArray(p.rack.components)
    && p.tracks.length === 1
    && p.tracks[0].wave === 'square'
    && p.tracks[0].grid.length === 16
    && p.activeTrackId === 'trk_1';
});

check('validateProject rejects non-object input', () => {
  try { validateProject(null); return false; } catch (e) { return true; }
});

check('validateProject rejects future schemaVersion', () => {
  const p = { schemaVersion: SCHEMA_VERSION + 1, name: 'x', tempo: 120, rack: { components: [], connections: [] }, tracks: [] };
  try { validateProject(p); return false; } catch (e) { return true; }
});

check('validateTrack rejects missing rt array', () => {
  try { validateTrack({ id: 'trk_1', grid: [] }); return false; } catch (e) { return true; }
});

check('validateComponent rejects missing id', () => {
  try { validateComponent({ type: 'oscillator' }); return false; } catch (e) { return true; }
});

check('migrateProject bumps missing schemaVersion to current', () => {
  const legacy = { name: 'old', tempo: 90, rack: { components: [], connections: [] }, tracks: [] };
  const p = migrateProject(legacy);
  return p.schemaVersion === SCHEMA_VERSION && p.tempo === 90;
});

check('migrateProject throws on future schemaVersion', () => {
  const future = { schemaVersion: SCHEMA_VERSION + 5, name: 'x', tempo: 120, rack: { components: [], connections: [] }, tracks: [] };
  try { migrateProject(future); return false; } catch (e) { return true; }
});

check('fromLegacy merges autosave rack + tracks store', () => {
  const project = fromLegacy({
    autosave: {
      components: [{ id: 'oscillator_1', type: 'oscillator', x: '100', y: '30', params: { wave: 'sawtooth' } }],
      connections: [{ from: 'oscillator_1', to: 'master' }],
    },
    tracksStore: {
      tempo: 140,
      activeTrackId: 'trk_b',
      tracks: [defaultTrackData({ id: 'trk_a' }), defaultTrackData({ id: 'trk_b', grid: ['C4'] })],
    },
    id: 'proj_legacy',
  });
  return project.schemaVersion === SCHEMA_VERSION
    && project.rack.components.length === 1
    && project.rack.components[0].id === 'oscillator_1'
    && project.rack.connections.length === 1
    && project.tempo === 140
    && project.tracks.length === 2
    && project.activeTrackId === 'trk_b'
    && project.tracks[1].grid[0].note === 'C4';
});

check('fromLegacy handles missing sections', () => {
  const project = fromLegacy({});
  return project.schemaVersion === SCHEMA_VERSION
    && project.rack.components.length === 0
    && project.rack.connections.length === 0
    && project.tracks.length === 0
    && project.activeTrackId === null;
});

check('defaultTrackData produces a full-length grid', () => {
  const t = defaultTrackData({ id: 'trk_x' });
  return t.grid.length === 16 && t.rt.length === 0 && t.adsr.a === 0.01;
});

check('emptyGrid returns 16 nulls', () => {
  const g = emptyGrid();
  return g.length === 16 && g.every(s => s === null);
});

// ---- markers (backlog #16) ------------------------------------------------
check('roundTrip preserves markers', () => {
  const p = serializeProject(fixtureState());
  const back = roundTrip(p);
  const markers = back.markers;
  return markers.length === 2
    && markers[0].id === 'mrk_1' && markers[0].name === 'Intro' && markers[0].tick === 0
    && markers[1].tick === 1920;
});

check('parseProject normalizes partial markers', () => {
  const raw = {
    schemaVersion: 1, name: 'x', tempo: 120,
    rack: { components: [], connections: [] },
    tracks: [],
    markers: [{ name: 'OnlyName' }, { tick: -5 }, 'garbage'],
  };
  const p = parseProject(raw);
  const m = p.markers[0];
  return p.markers.length === 3
    && m && typeof m.id === 'string' && m.name === 'OnlyName' && m.tick === 0
    && p.markers[1].tick === 0 && typeof p.markers[1].name === 'string';
});

check('parseProject fills missing markers with an empty array', () => {
  const raw = { schemaVersion: 1, name: 'x', tempo: 120, rack: { components: [], connections: [] }, tracks: [] };
  const p = parseProject(raw);
  return Array.isArray(p.markers) && p.markers.length === 0;
});

check('validateProject rejects a non-array markers field', () => {
  const p = { schemaVersion: 1, name: 'x', tempo: 120, rack: { components: [], connections: [] }, tracks: [], markers: 'nope' };
  try { validateProject(p); return false; } catch (e) { return true; }
});

check('serializeProject without markers yields an empty markers array', () => {
  const st = fixtureState();
  delete st.markers;
  const p = serializeProject(st);
  return Array.isArray(p.markers) && p.markers.length === 0;
});

check('defaultTrackData starts with muted=false and solo=false', () => {
  const t = defaultTrackData({ id: 'trk_1' });
  return t.muted === false && t.solo === false;
});

check('round-trip preserves muted and solo flags', () => {
  const st = fixtureState();
  st.tracks = [defaultTrackData({ id: 'trk_1', muted: true, solo: true })];
  const p = roundTrip(st);
  const t = p.tracks.find(x => x.id === 'trk_1');
  return t && t.muted === true && t.solo === true;
});

check('parseProject normalizes tracks missing muted/solo', () => {
  const raw = {
    schemaVersion: SCHEMA_VERSION, name: 'x', tempo: 120,
    rack: { components: [], connections: [] },
    tracks: [{ id: 'trk_1', name: 'T', color: '#4af74a', grid: [] }],
  };
  const p = parseProject(raw);
  const t = p.tracks[0];
  return t && t.muted === false && t.solo === false;
});

check('defaultTrackData starts with no folder and not collapsed', () => {
  const t = defaultTrackData({ id: 'trk_1' });
  return t.folder === null && t.collapsed === false;
});

check('round-trip preserves folder and collapsed', () => {
  const st = fixtureState();
  st.tracks = [defaultTrackData({ id: 'trk_1', folder: 'trk_9', collapsed: true })];
  const p = roundTrip(st);
  const t = p.tracks.find(x => x.id === 'trk_1');
  return t && t.folder === 'trk_9' && t.collapsed === true;
});

check('parseProject normalizes tracks missing folder/collapsed', () => {
  const raw = {
    schemaVersion: 1, name: 'x', tempo: 120,
    rack: { components: [], connections: [] },
    tracks: [{ id: 'trk_1', grid: [], rt: [] }],
  };
  const p = parseProject(raw);
  const t = p.tracks[0];
  return t.folder === null && t.collapsed === false;
});

check('round-trip preserves insert devices', () => {
  const st = fixtureState();
  st.tracks = [defaultTrackData({
    id: 'trk_1',
    inserts: [{ id: 'ins_1', type: 'delay', params: { time: 0.6, feedback: 0.3, mix: 0.5 } }],
  })];
  const p = serializeProject(st);
  const back = roundTrip(p);
  const ins = back.tracks[0].inserts;
  return Array.isArray(ins) && ins.length === 1
    && ins[0].id === 'ins_1' && ins[0].type === 'delay'
    && ins[0].params.time === 0.6 && ins[0].params.mix === 0.5;
});

check('parseProject normalizes tracks missing inserts', () => {
  const raw = {
    schemaVersion: 1, name: 'x', tempo: 120,
    rack: { components: [], connections: [] },
    tracks: [{ id: 'trk_1', grid: [], rt: [], clips: [] }],
  };
  const p = parseProject(raw);
  const t = p.tracks[0];
  return Array.isArray(t.inserts) && t.inserts.length === 0;
});

check('serializeProject round-trips midiChannel', () => {
  const st = fixtureState();
  st.tracks = [defaultTrackData({ id: 'trk_1', midiChannel: 5 })];
  const p = serializeProject(st);
  return p.tracks[0].midiChannel === 5;
});
check('parseProject normalizes midiChannel', () => {
  const raw = {
    schemaVersion: 1, name: 'x', tempo: 120,
    rack: { components: [], connections: [] },
    tracks: [{ id: 'trk_1', midiChannel: 12, grid: [], rt: [], clips: [] }],
  };
  const p = parseProject(raw);
  return p.tracks[0].midiChannel === 12;
});
check('parseProject defaults midiChannel to null when missing', () => {
  const raw = {
    schemaVersion: 1, name: 'x', tempo: 120,
    rack: { components: [], connections: [] },
    tracks: [{ id: 'trk_1', grid: [], rt: [], clips: [] }],
  };
  const p = parseProject(raw);
  return p.tracks[0].midiChannel === null;
});

summary.textContent = `SUMMARY: ${passed.length} passed, ${failed.length} failed`;
if (failed.length > 0) {
  summary.style.color = '#ff4444';
  summary.textContent += ` — ${failed.join(', ')}`;
}