// Unified project persistence. One versioned localStorage key holds the whole
// snapshot (rack + tracks + tempo + active track); the two pre-project keys
// (`sidSynthAutosave`, `sidSynthTracks`) are migrated on first read.
// Pure module — storage, capture() and apply() are injected, so it is
// unit-testable in the browser without DOM or AudioContext.
//
// Revision-based autosave (P0): every capture is hashed (FNV-1a over its
// JSON); unchanged content is never rewritten. Successful saves rotate the
// previous raw snapshot into a bounded backup ring for recovery, and every
// attempt is recorded in a bounded journal. Subscribers get save-state
// transitions (dirty/saved/error) for the save-status line.
import { migrateProject, fromLegacy } from './migrate.js';
import { validateProject } from './serialize.js';

export const PROJECT_STORAGE_KEY = 'sidSynthProject';
export const LEGACY_AUTOSAVE_KEY = 'sidSynthAutosave';
export const LEGACY_TRACKS_KEY = 'sidSynthTracks';
export const SNAPSHOT_SUFFIX = ':snapshots';
export const MAX_SNAPSHOTS = 5;
export const MAX_SNAPSHOT_BYTES = 1500000;
export const MAX_JOURNAL = 50;

// Fast non-crypto content hash (FNV-1a, hex). Revisions only need to tell
// "changed or not" within one profile — no security properties required.
export function revisionOf(doc) {
  const text = typeof doc === 'string' ? doc : JSON.stringify(doc);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}

export function createProjectStore(cfg = {}) {
  const storage = cfg.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const storageKey = cfg.storageKey || PROJECT_STORAGE_KEY;
  const snapshotKey = storageKey + (cfg.snapshotSuffix || SNAPSHOT_SUFFIX);
  const autosaveKey = cfg.autosaveKey || LEGACY_AUTOSAVE_KEY;
  const tracksKey = cfg.tracksKey || LEGACY_TRACKS_KEY;
  const debounceMs = cfg.debounceMs ?? 600;
  const maxSnapshots = cfg.maxSnapshots ?? MAX_SNAPSHOTS;
  const capture = cfg.capture;   // () => project doc (serializable object)
  const apply = cfg.apply;       // (project) => void (restore live app state)
  let timer = null;
  let blocked = false;
  const onError = cfg.onError || (() => {});
  const subscribers = new Set();

  // Save-state machine for the status line.
  let saveState = 'clean'; // clean | dirty | saved | error
  let lastSavedAt = null;
  let lastSavedRevision = null;
  let lastError = null;
  const journal = [];

  function notify() {
    const s = getSaveState();
    subscribers.forEach(fn => { try { fn(s); } catch (e) {} });
  }

  function logJournal(entry) {
    journal.push({ t: new Date().toISOString(), ...entry });
    if (journal.length > MAX_JOURNAL) journal.splice(0, journal.length - MAX_JOURNAL);
  }

  function read(key) {
    try { return storage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try { storage.setItem(key, value); return true; }
    catch (e) { onError(e); return false; }
  }
  function remove(key) {
    try { storage.removeItem(key); } catch (e) {}
  }

  function readSnapshots() {
    try {
      const raw = read(snapshotKey);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function writeSnapshots(arr) {
    return write(snapshotKey, JSON.stringify(arr.slice(-maxSnapshots)));
  }

  // Snapshot the live state to the unified key right now. Writes only when
  // the content revision changed; rotates the previous raw into backups.
  // Returns true when bytes were written, false otherwise.
  function saveNow() {
    clearTimeout(timer);
    timer = null;
    if (!capture || blocked) return false;
    let doc;
    try {
      doc = capture();
      // Validate project before serialization to catch invalid state early
      validateProject(doc);
    }
    catch (e) {
      lastError = e;
      saveState = 'error';
      logJournal({ result: 'error', detail: 'capture/validate: ' + (e.message || e) });
      onError(e);
      notify();
      return false;
    }
    let text;
    try { text = JSON.stringify(doc); }
    catch (e) {
      lastError = e;
      saveState = 'error';
      logJournal({ result: 'error', detail: 'stringify: ' + (e.message || e) });
      onError(e);
      notify();
      return false;
    }
    const rev = revisionOf(text);
    if (rev === lastSavedRevision) {
      saveState = saveState === 'error' ? saveState : 'clean';
      logJournal({ result: 'clean-skip', rev });
      notify();
      return false;
    }
    const prevRaw = read(storageKey);
    if (!write(storageKey, text)) {
      // Quota pressure: drop the oldest backup and retry once before failing.
      const snaps = readSnapshots();
      if (snaps.length && write(snapshotKey, JSON.stringify(snaps.slice(1)))) {
        if (!write(storageKey, text)) {
          lastError = new Error('autosave write failed');
          saveState = 'error';
          logJournal({ result: 'error', rev, detail: 'write failed after prune' });
          notify();
          return false;
        }
      } else {
        lastError = new Error('autosave write failed');
        saveState = 'error';
        logJournal({ result: 'error', rev, detail: 'write failed' });
        notify();
        return false;
      }
    }
    if (prevRaw) {
      try {
        if (prevRaw.length <= MAX_SNAPSHOT_BYTES) {
          const snaps = readSnapshots();
          snaps.push({ t: new Date().toISOString(), rev: revisionOf(prevRaw), raw: prevRaw });
          writeSnapshots(snaps);
          logJournal({ result: 'snapshot', rev: revisionOf(prevRaw), bytes: prevRaw.length });
        } else {
          logJournal({ result: 'snapshot-skipped', detail: 'too large: ' + prevRaw.length });
        }
      } catch (e) {
        logJournal({ result: 'snapshot-skipped', detail: String((e && e.message) || e) });
      }
    }
    lastSavedRevision = rev;
    lastSavedAt = new Date().toISOString();
    lastError = null;
    saveState = 'saved';
    logJournal({ result: 'saved', rev, bytes: text.length });
    notify();
    return true;
  }

  // Debounced save.
  function save() {
    clearTimeout(timer);
    timer = setTimeout(saveNow, debounceMs);
  }

  function markDirty() {
    if (saveState !== 'error') saveState = 'dirty';
    logJournal({ result: 'dirty' });
    notify();
    save();
  }

  // Immediate write for page unload (localStorage is synchronous).
  function flush() {
    return saveNow();
  }

  // Read the unified key; when absent, migrate from the legacy keys, write the
  // migrated doc back (so the next load is a straight read) and drop the legacy
  // keys. Returns the parsed project doc, or null when nothing is stored.
  function readProject() {
    const raw = read(storageKey);
    if (raw) {
      try {
        const project = migrateProject(JSON.parse(raw));
        // Validate after migration to ensure loaded data is valid
        validateProject(project);
        return project;
      }
      catch (e) {
        // Never replace unreadable/newer data with an empty startup session.
        blocked = true;
        onError(e);
        return null;
      }
    }
    let autosave = null;
    let tracksStore = null;
    try { autosave = JSON.parse(read(autosaveKey)); } catch (e) {}
    try { tracksStore = JSON.parse(read(tracksKey)); } catch (e) {}
    if (autosave === null && tracksStore === null) return null;
    let project;
    try { project = fromLegacy({ autosave, tracksStore }); }
    catch (e) { blocked = true; onError(e); return null; }
    if (write(storageKey, JSON.stringify(project))) {
      remove(autosaveKey);
      remove(tracksKey);
    }
    return project;
  }

  function restore() {
    const project = readProject();
    if (project) {
      try { if (apply) apply(project); }
      catch (e) {
        blocked = true;
        lastError = e;
        saveState = 'error';
        logJournal({ result: 'error', detail: 'restore: ' + e.message });
        onError(e);
        notify();
        return null;
      }
      try { lastSavedRevision = revisionOf(JSON.stringify(project)); }
      catch (e) { lastSavedRevision = null; }
      saveState = 'clean';
      notify();
    }
    return project;
  }

  // Newest backup snapshot, parsed + migrated — or null when no backups.
  // The caller applies it (and usually saves right after to adopt it).
  function recoverSnapshot() {
    const snaps = readSnapshots();
    for (let i = snaps.length - 1; i >= 0; i--) {
      const raw = snaps[i] && snaps[i].raw;
      if (typeof raw !== 'string') continue;
      try { return migrateProject(JSON.parse(raw)); }
      catch (e) { continue; }
    }
    return null;
  }

  function readRaw() {
    return read(storageKey);
  }

  function clear() {
    clearTimeout(timer);
    timer = null;
    remove(storageKey);
    blocked = false;
    lastSavedRevision = null;
    saveState = 'clean';
    notify();
  }

  function getSaveState() {
    return {
      state: saveState,
      savedAt: lastSavedAt,
      revision: lastSavedRevision,
      error: lastError ? String((lastError && lastError.message) || lastError) : null,
      blocked,
    };
  }

  function getJournal() {
    return journal.map(e => ({ ...e }));
  }

  function listSnapshots() {
    return readSnapshots().map(s => ({ t: s.t, rev: s.rev, bytes: typeof s.raw === 'string' ? s.raw.length : 0 }));
  }

  return {
    saveNow, save, markDirty, flush, restore, readRaw, readProject, clear,
    recoverSnapshot, listSnapshots, getSaveState, getJournal, isBlocked: () => blocked,
    subscribe: (fn) => { if (typeof fn === 'function') subscribers.add(fn); return () => subscribers.delete(fn); },
  };
}
