import { SCHEMA_VERSION, defaultProject, defaultTrackData, defaultClip } from './defaultProject.js';
import { normalizeMarker } from './markers.js';
import { normalizeAsset } from '../audio/assetStore.js';
import { normalizeAudioRef } from '../audio/audioEngine.js';

// --- validation -----------------------------------------------------------
// Throws with a descriptive message on any structural problem. Kept strict
// enough that a round-trip can never produce a doc the app cannot load.
export function validateProject(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('project must be an object');
  if (typeof p.schemaVersion !== 'number') throw new Error('missing schemaVersion');
  if (p.schemaVersion > SCHEMA_VERSION) throw new Error('unsupported schemaVersion ' + p.schemaVersion);
  if (typeof p.name !== 'string') throw new Error('missing project name');
  if (typeof p.tempo !== 'number' || !(p.tempo > 0)) throw new Error('invalid tempo');
  if (!p.rack || typeof p.rack !== 'object') throw new Error('missing rack');
  if (!Array.isArray(p.rack.components)) throw new Error('rack.components must be an array');
  if (!Array.isArray(p.rack.connections)) throw new Error('rack.connections must be an array');
  if (!Array.isArray(p.tracks)) throw new Error('tracks must be an array');
  if (p.markers !== undefined && !Array.isArray(p.markers)) throw new Error('markers must be an array');
  if (p.assets !== undefined && !Array.isArray(p.assets)) throw new Error('assets must be an array');
  return true;
}

export function validateComponent(c) {
  if (!c || typeof c !== 'object') throw new Error('component must be an object');
  if (typeof c.id !== 'string' || !c.id) throw new Error('component missing id');
  if (typeof c.type !== 'string') throw new Error('component ' + c.id + ' missing type');
  return true;
}

export function validateTrack(t) {
  if (!t || typeof t !== 'object') throw new Error('track must be an object');
  if (typeof t.id !== 'string' || !t.id) throw new Error('track missing id');
  if (!Array.isArray(t.grid)) throw new Error('track ' + t.id + ' grid must be an array');
  if (!Array.isArray(t.rt)) throw new Error('track ' + t.id + ' rt must be an array');
  if (t.clips !== undefined && !Array.isArray(t.clips)) throw new Error('track ' + t.id + ' clips must be an array');
  return true;
}

// --- serialize ------------------------------------------------------------
// Build a versioned project document from live app state. `components` is a map
// id -> {type, element, ...params} and captureParams(comp) extracts params.
// `tracks` is the plain-data array from trackEngine.getTracks().
export function serializeProject({ components, connections, captureParams, tracks, tempo, activeTrackId, id, name, markers, loopEnabled, loopStartTicks, loopEndTicks, projectEndTicks, assets }) {
  const rackComponents = Object.keys(components || {}).map(cid => {
    const comp = components[cid];
    return {
      id: cid,
      type: comp.type,
      x: parseInt(comp.element.style.left, 10) || 0,
      y: parseInt(comp.element.style.top, 10) || 0,
      params: captureParams ? captureParams(comp) : {},
    };
  });
  const rackConnections = (connections || []).map(c => ({
    from: c.from,
    to: c.to,
    toChannel: c.toChannel ?? null,
    outChannel: c.outChannel ?? 0,
    ...(c.mod ? { mod: true } : {}),
  }));
  const project = defaultProject({
    id, name, tempo, activeTrackId,
    rackComponents,
    rackConnections,
    tracks: (tracks || []).map(normalizeTrackData),
    markers: (markers || []).map(normalizeMarker),
    assets: (assets || []).map(normalizeAsset),
    loopEnabled,
    loopStartTicks,
    loopEndTicks,
    projectEndTicks,
  });
  validateProject(project);
  (project.rack.components || []).forEach(validateComponent);
  (project.tracks || []).forEach(validateTrack);
  return project;
}

export function serializeProjectJson(opts) {
  return JSON.stringify(serializeProject(opts));
}

// --- deserialize ----------------------------------------------------------
// Parse a project document from a string or object; normalizes missing/legacy
// fields to the current schema (fill defaults, do not throw on benign gaps).
export function parseProject(data) {
  let project = typeof data === 'string' ? safeParse(data) : data;
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw new Error('invalid project data');
  }
  if (typeof project.schemaVersion !== 'number' || project.schemaVersion < 1) {
    project.schemaVersion = SCHEMA_VERSION;
  }
  if (project.schemaVersion > SCHEMA_VERSION) {
    throw new Error('unsupported schemaVersion ' + project.schemaVersion);
  }
  project.name = typeof project.name === 'string' ? project.name : 'Untitled';
  project.id = typeof project.id === 'string' && project.id ? project.id : defaultProject().id;
  project.tempo = typeof project.tempo === 'number' && project.tempo > 0 ? project.tempo : 120;
  project.loopEnabled = !!project.loopEnabled;
  project.loopStartTicks = typeof project.loopStartTicks === 'number' && project.loopStartTicks >= 0 ? project.loopStartTicks : 0;
  project.loopEndTicks = typeof project.loopEndTicks === 'number' && project.loopEndTicks > 0 ? project.loopEndTicks : 4 * 480;
  project.projectEndTicks = typeof project.projectEndTicks === 'number' && project.projectEndTicks > 0 ? project.projectEndTicks : null;
  project.rack = project.rack && typeof project.rack === 'object' ? {
    components: Array.isArray(project.rack.components) ? project.rack.components.map(normalizeComponent) : [],
    connections: Array.isArray(project.rack.connections) ? project.rack.connections : [],
  } : { components: [], connections: [] };
  project.tracks = Array.isArray(project.tracks) ? project.tracks.map(normalizeTrackData) : [];
  project.markers = Array.isArray(project.markers) ? project.markers.map(normalizeMarker) : [];
  project.assets = Array.isArray(project.assets) ? project.assets.map(normalizeAsset) : [];
  project.activeTrackId = project.activeTrackId ?? (project.tracks[0] && project.tracks[0].id) ?? null;
  return project;
}

function safeParse(str) {
  try { return JSON.parse(str); } catch (e) { throw new Error('project JSON parse failed: ' + e.message); }
}

// Grid cells may be legacy strings ("C4") or {note, dur}; both become
// {note, dur} objects so the app scheduler can read one shape.
export function normalizeCell(c) {
  if (!c) return null;
  if (typeof c === 'string') return { note: c, dur: 1 };
  if (typeof c === 'object') {
    return { note: c.note, dur: typeof c.dur === 'number' && c.dur > 0 ? c.dur : 1 };
  }
  return null;
}

export function normalizeTrackData(t) {
  const base = defaultTrackData();
  const src = t && typeof t === 'object' ? t : {};
  const grid = Array.isArray(src.grid) ? src.grid.map(normalizeCell) : base.grid;
  const rt = Array.isArray(src.rt) ? src.rt.map(n => ({ note: n.note, start: n.start, dur: n.dur })) : [];
  const clips = Array.isArray(src.clips) ? src.clips.map(normalizeClip) : [];
  const inserts = Array.isArray(src.inserts)
    ? src.inserts
      .filter(i => i && typeof i === 'object' && typeof i.type === 'string')
      .map(i => ({ id: typeof i.id === 'string' && i.id ? i.id : 'ins_' + Math.random().toString(36).slice(2, 8), type: i.type, params: i.params && typeof i.params === 'object' ? { ...i.params } : {} }))
    : [];
  return {
    id: typeof src.id === 'string' && src.id ? src.id : base.id,
    name: typeof src.name === 'string' ? src.name : base.name,
    color: typeof src.color === 'string' ? src.color : base.color,
    enabled: src.enabled !== false,
    monitor: src.monitor !== false,
    height: typeof src.height === 'number' ? src.height : null,
    folder: typeof src.folder === 'string' && src.folder ? src.folder : null,
    collapsed: src.collapsed === true,
    muted: src.muted === true,
    solo: src.solo === true,
    wave: typeof src.wave === 'string' ? src.wave : base.wave,
    filterType: typeof src.filterType === 'string' ? src.filterType : base.filterType,
    filterFreq: typeof src.filterFreq === 'number' ? src.filterFreq : base.filterFreq,
    filterQ: typeof src.filterQ === 'number' ? src.filterQ : base.filterQ,
    adsr: src.adsr && typeof src.adsr === 'object' ? { ...base.adsr, ...src.adsr } : base.adsr,
    volume: typeof src.volume === 'number' ? src.volume : base.volume,
    gridNote: typeof src.gridNote === 'string' ? src.gridNote : base.gridNote,
    gridDur: typeof src.gridDur === 'number' && src.gridDur > 0 ? src.gridDur : base.gridDur,
    midiChannel: typeof src.midiChannel === 'number' ? src.midiChannel : null,
    grid,
    rt,
    clips,
    inserts,
  };
}

// Clips are blocks of musical time on a track; `events` (PPQ ticks) are the
// clip's note store and are preserved through serialization.
export function normalizeClip(c) {
  const base = defaultClip();
  const src = c && typeof c === 'object' ? c : {};
  return {
    id: typeof src.id === 'string' && src.id ? src.id : base.id,
    name: typeof src.name === 'string' ? src.name : base.name,
    color: typeof src.color === 'string' ? src.color : null,
    start: typeof src.start === 'number' && src.start >= 0 ? src.start : base.start,
    length: typeof src.length === 'number' && src.length > 0 ? src.length : base.length,
    events: Array.isArray(src.events) ? src.events.slice() : [],
    audio: normalizeAudioRef(src.audio),
  };
}

export function normalizeComponent(c) {
  const src = c && typeof c === 'object' ? c : {};
  return {
    id: typeof src.id === 'string' && src.id ? src.id : '',
    type: typeof src.type === 'string' ? src.type : '',
    x: typeof src.x === 'number' ? src.x : 0,
    y: typeof src.y === 'number' ? src.y : 0,
    params: src.params && typeof src.params === 'object' ? src.params : {},
  };
}

// Round-trip: serializing then parsing yields a structurally identical doc
// (used by tests to prove create → serialize → load → migrate → identical).
export function roundTrip(project) {
  return parseProject(JSON.stringify(project));
}