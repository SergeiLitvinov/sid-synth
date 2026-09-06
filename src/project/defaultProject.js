import { normalizeMarker } from './markers.js';
import { normalizeAsset } from '../audio/assetStore.js';

export const SCHEMA_VERSION = 1;
export const STEPS_PER_LOOP = 16;

export function createProjectId() {
  return 'proj_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function emptyGrid() {
  return Array(STEPS_PER_LOOP).fill(null);
}

// Default length of one clip in ticks (one 4/4 bar at PPQ 480).
export const DEFAULT_CLIP_LENGTH_TICKS = 1920;

// Plain-data MIDI clip: a block of musical time on a track. `start`/`length`
// are in PPQ ticks so clips line up with the transport timeline. `events`
// (notes, PPQ ticks) are the clip's note store: the loop clip (start 0)
// mirrors the track's grid/rt notes, kept in sync by trackEngine.
export function defaultClip(cfg = {}) {
  return {
    id: cfg.id || 'clip_' + Math.random().toString(36).slice(2, 8),
    name: cfg.name || 'Clip',
    color: cfg.color || null,
    start: cfg.start === undefined ? 0 : cfg.start,
    length: cfg.length === undefined ? DEFAULT_CLIP_LENGTH_TICKS : cfg.length,
    events: Array.isArray(cfg.events) ? cfg.events.slice() : [],
  };
}

// Plain-data default track (no voice, no DOM) — matches trackEngine.getTracks().
export function defaultTrackData(cfg = {}) {
  return {
    id: cfg.id || 'trk_' + Math.random().toString(36).slice(2, 8),
    name: cfg.name || 'Track 1',
    color: cfg.color || '#4af74a',
    enabled: cfg.enabled !== false,
    monitor: cfg.monitor !== false,
    muted: !!cfg.muted,
    solo: !!cfg.solo,
    height: cfg.height || null,
    folder: cfg.folder || null,
    collapsed: !!cfg.collapsed,
    wave: cfg.wave || 'square',
    filterType: cfg.filterType || 'none',
    filterFreq: cfg.filterFreq === undefined ? 1200 : cfg.filterFreq,
    filterQ: cfg.filterQ === undefined ? 1 : cfg.filterQ,
    adsr: cfg.adsr || { a: 0.01, d: 0.1, s: 0.7, r: 0.1 },
    volume: cfg.volume === undefined ? 0.85 : cfg.volume,
    gridNote: cfg.gridNote || 'C4',
    gridDur: cfg.gridDur || 1,
    midiChannel: typeof cfg.midiChannel === 'number' ? cfg.midiChannel : null,
    grid: Array.isArray(cfg.grid) ? cfg.grid.slice() : emptyGrid(),
    rt: Array.isArray(cfg.rt) ? cfg.rt.map(n => ({ ...n })) : [],
    clips: Array.isArray(cfg.clips) ? cfg.clips.map(c => ({ ...c })) : [],
    inserts: Array.isArray(cfg.inserts) ? cfg.inserts.map(i => ({ ...i, params: { ...(i.params || {}) } })) : [],
  };
}

export function defaultProject(cfg = {}) {
  const ppq = 480;
  const now = new Date().toISOString();
  const loopEnd = cfg.loopEndTicks !== undefined ? cfg.loopEndTicks : 4 * ppq;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: cfg.id || createProjectId(),
    name: cfg.name || 'Untitled',
    createdAt: cfg.createdAt || now,
    modifiedAt: cfg.modifiedAt || now,
    tempo: cfg.tempo === undefined ? 120 : cfg.tempo,
    loopEnabled: !!cfg.loopEnabled,
    loopStartTicks: cfg.loopStartTicks !== undefined ? cfg.loopStartTicks : 0,
    loopEndTicks: loopEnd,
    projectEndTicks: cfg.projectEndTicks !== undefined ? cfg.projectEndTicks : null,
    rack: {
      components: Array.isArray(cfg.rackComponents) ? cfg.rackComponents : [],
      connections: Array.isArray(cfg.rackConnections) ? cfg.rackConnections : [],
    },
    tracks: Array.isArray(cfg.tracks) ? cfg.tracks.map(t => ({ ...t })) : [],
    markers: Array.isArray(cfg.markers) ? cfg.markers.map(normalizeMarker) : [],
    // Media-pool manifest (M4): metadata only — binary audio lives in the
    // IndexedDB asset store keyed by hash, never inside the project JSON.
    assets: Array.isArray(cfg.assets) ? cfg.assets.map(normalizeAsset) : [],
    activeTrackId: cfg.activeTrackId ?? null,
  };
}