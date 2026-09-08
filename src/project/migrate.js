import { SCHEMA_VERSION, defaultProject } from './defaultProject.js';
import { parseProject, normalizeTrackData } from './serialize.js';

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
  return parseProject(project);
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
    project.tracks = store.tracks.map(t => normalizeLegacyTrack(t, legacyTempo));
  }
  project.activeTrackId = store && store.activeTrackId
    ? store.activeTrackId
    : (project.tracks[0] && project.tracks[0].id) || null;
  return migrateProject(project);
}

function normalizeLegacyTrack(t, bpm) {
  // Legacy grid/rt fold into a loop clip inside normalizeTrackData; the
  // pre-project store tempo keeps rt seconds conversion accurate.
  return normalizeTrackData(t, { bpm });
}
