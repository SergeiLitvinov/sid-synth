import { defaultProject } from './defaultProject.js';
import { parseProject } from './serialize.js';

// --- migration ------------------------------------------------------------
// Bump a project document to the current schema version. Accepts an object or
// JSON string; returns a normalized object at SCHEMA_VERSION.
export function migrateProject(input) {
  // Only the unversioned legacy shape is migrated implicitly. Explicit
  // invalid/future versions are rejected by the parser before normalization.
  return parseProject(input);
}

// --- legacy import --------------------------------------------------------
// Build a versioned project from the pre-project localStorage keys.
//   autosave    — parsed `sidSynthAutosave` ({ components, connections })
//   tracksStore — parsed `sidSynthTracks` ({ bpm, tracks, activeTrackId })
// Missing keys become empty sections, so migration never loses the app.
export function fromLegacy({ autosave, tracksStore, id, name } = {}) {
  const project = defaultProject({ id, name });
  for (const [key, value] of Object.entries({ autosave, tracksStore })) {
    if (value != null && (typeof value !== 'object' || Array.isArray(value))) throw new Error('legacy.' + key + ': expected object');
  }
  const rack = autosave && typeof autosave === 'object' ? autosave : null;
  for (const key of ['components', 'connections']) {
    if (rack && rack[key] !== undefined && !Array.isArray(rack[key])) throw new Error('legacy.rack.' + key + ': expected array');
  }
  project.rack.components = rack && Array.isArray(rack.components) ? rack.components.map(c => ({
    id: c.id || c.type,
    type: c.type,
    x: c.x === undefined ? 0 : Number(c.x),
    y: c.y === undefined ? 0 : Number(c.y),
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
  const legacyTempo = store ? (store.tempo !== undefined ? store.tempo : store.bpm) : undefined;
  if (legacyTempo !== undefined) project.tempo = legacyTempo;
  if (store && store.tracks !== undefined) {
    project.tracks = store.tracks;
  }
  project.activeTrackId = store && store.activeTrackId
    ? store.activeTrackId
    : (project.tracks[0] && project.tracks[0].id) || null;
  return migrateProject(project);
}
