import { SCHEMA_VERSION, defaultProject, defaultTrackData } from './defaultProject.js';
import { parseProject, normalizeCell, normalizeClip } from './serialize.js';

// --- migration ------------------------------------------------------------
// Bump a project document to the current schema version. Accepts an object or
// JSON string; returns a normalized object at SCHEMA_VERSION.
export function migrateProject(input) {
  let project = typeof input === 'string' ? parseProject(input) : input;
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw new Error('migrate: invalid project');
  }
  const v = typeof project.schemaVersion === 'number' ? project.schemaVersion : 0;
  if (v > SCHEMA_VERSION) {
    throw new Error('migrate: unsupported schemaVersion ' + v);
  }
  if (v < SCHEMA_VERSION) {
    // v0 → v1: re-run full normalization so defaults/fixed fields are present.
    project = parseProject(project);
    project.schemaVersion = SCHEMA_VERSION;
  }
  return project;
}

// --- legacy import --------------------------------------------------------
// Build a versioned project from the pre-project localStorage keys.
//   autosave    — parsed `sidSynthAutosave` ({ components, connections })
//   tracksStore — parsed `sidSynthTracks` ({ bpm, tracks, activeTrackId })
// Missing keys become empty sections, so migration never loses the app.
export function fromLegacy({ autosave, tracksStore, id, name } = {}) {
  const project = defaultProject({ id, name });
  const rack = autosave && typeof autosave === 'object' ? autosave : null;
  project.rack.components = rack && Array.isArray(rack.components) ? rack.components.map(c => ({
    id: c.id || c.type,
    type: c.type,
    x: parseInt(c.x, 10) || 0,
    y: parseInt(c.y, 10) || 0,
    params: c.params && typeof c.params === 'object' ? c.params : {},
  })) : [];
  project.rack.connections = rack && Array.isArray(rack.connections)
    ? rack.connections.map(c => ({
        from: c.from, to: c.to,
        toChannel: c.toChannel ?? null,
        outChannel: c.outChannel ?? 0,
        ...(c.mod ? { mod: true } : {}),
      }))
    : [];

  const store = tracksStore && typeof tracksStore === 'object' ? tracksStore : null;
  const legacyTempo = store && typeof store.tempo === 'number' ? store.tempo : (store && store.bpm);
  if (typeof legacyTempo === 'number' && legacyTempo > 0) project.tempo = legacyTempo;
  if (Array.isArray(store && store.tracks)) {
    project.tracks = store.tracks.map(t => normalizeLegacyTrack(t));
  }
  project.activeTrackId = store && store.activeTrackId
    ? store.activeTrackId
    : (project.tracks[0] && project.tracks[0].id) || null;
  return migrateProject(project);
}

function normalizeLegacyTrack(t) {
  const base = defaultTrackData();
  const src = t && typeof t === 'object' ? t : {};
  const grid = Array.isArray(src.grid) ? src.grid.map(normalizeCell) : base.grid;
  const rt = Array.isArray(src.rt) ? src.rt.map(n => ({ note: n.note, start: n.start, dur: n.dur })) : [];
  const clips = Array.isArray(src.clips) ? src.clips.map(normalizeClip) : [];
  return {
    id: typeof src.id === 'string' && src.id ? src.id : base.id,
    name: typeof src.name === 'string' ? src.name : base.name,
    color: typeof src.color === 'string' ? src.color : base.color,
    enabled: src.enabled !== false,
    monitor: src.monitor !== false,
    height: typeof src.height === 'number' ? src.height : base.height,
    folder: typeof src.folder === 'string' && src.folder ? src.folder : null,
    collapsed: src.collapsed === true,
    wave: typeof src.wave === 'string' ? src.wave : base.wave,
    filterType: typeof src.filterType === 'string' ? src.filterType : base.filterType,
    filterFreq: typeof src.filterFreq === 'number' ? src.filterFreq : base.filterFreq,
    filterQ: typeof src.filterQ === 'number' ? src.filterQ : base.filterQ,
    adsr: src.adsr && typeof src.adsr === 'object' ? { ...base.adsr, ...src.adsr } : base.adsr,
    volume: typeof src.volume === 'number' ? src.volume : base.volume,
    gridNote: typeof src.gridNote === 'string' ? src.gridNote : base.gridNote,
    gridDur: typeof src.gridDur === 'number' && src.gridDur > 0 ? src.gridDur : base.gridDur,
    grid,
    rt,
    clips,
  };
}