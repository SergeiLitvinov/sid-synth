import { defaultTrackData } from './defaultProject.js';

// Command factories for recorder track operations. Each returns a command
// `{ label, apply, undo }` suitable for createHistory. Commands mutate the
// live track engine and capture enough state to undo the mutation.

function copyGrid(grid) {
  return (grid || []).map(c => (c ? { note: c.note, dur: c.dur } : null));
}

function copyRt(rt) {
  return (rt || []).map(n => ({ note: n.note, start: n.start, dur: n.dur }));
}

function copyClips(clips) {
  return (clips || []).map(c => ({ ...c, events: (c.events || []).slice() }));
}

function copyInserts(inserts) {
  return (inserts || []).map(i => ({ ...i, params: { ...(i.params || {}) } }));
}

function trackSnapshot(t) {
  return {
    id: t.id, name: t.name, color: t.color, enabled: t.enabled, monitor: t.monitor, height: t.height || null,
    muted: t.muted, solo: t.solo, folder: t.folder || null, collapsed: !!t.collapsed,
    wave: t.wave, filterType: t.filterType, filterFreq: t.filterFreq, filterQ: t.filterQ,
    adsr: { ...t.adsr }, volume: t.volume, gridNote: t.gridNote, gridDur: t.gridDur,
    midiChannel: typeof t.midiChannel === 'number' ? t.midiChannel : null,
    grid: copyGrid(t.grid), rt: copyRt(t.rt), clips: copyClips(t.clips),
    inserts: copyInserts(t.inserts),
  };
}

export function addTrackCommand(engine, cfg = {}) {
  return {
    label: 'Add track',
    createdId: null,
    apply() {
      // Redo re-creates with the SAME id so the state after redo is identical.
      const t = engine.addTrack(this.createdId ? { ...cfg, id: this.createdId } : cfg);
      this.createdId = t.id;
    },
    undo() {
      if (this.createdId) engine.removeTrack(this.createdId);
    },
  };
}

export function removeTrackCommand(engine, id) {
  let snapshot = null;
  return {
    label: 'Remove track',
    apply() {
      const t = engine.byId[id];
      if (!t) return;
      snapshot = trackSnapshot(t);
      engine.removeTrack(id);
    },
    undo() {
      if (snapshot) engine.addTrack(snapshot);
    },
  };
}

// Resize a track's arranger lane (backlog #22). Captures the previous height
// so undo restores it; the arranger re-renders lane heights on subscribe.
export function resizeTrackCommand(engine, id, height) {
  let before = null;
  let hadHeight = false;
  return {
    label: 'Resize track lane',
    apply() {
      const t = engine.byId[id];
      if (!t) return;
      before = t.height || null;
      hadHeight = before !== null;
      engine.updateTrack(id, { height });
    },
    undo() {
      if (hadHeight) engine.updateTrack(id, { height: before });
      else engine.updateTrack(id, { height: null });
    },
  };
}

// Captures the pre-edit values of the patched keys only, so undo restores
// exactly what the edit changed (e.g. wave, filterType, gridNote, gridDur).
export function updateTrackCommand(engine, id, patch) {
  let before = null;
  return {
    label: 'Update track',
    apply() {
      const t = engine.byId[id];
      if (!t) return;
      before = {};
      Object.keys(patch).forEach(k => {
        const v = t[k];
        if (Array.isArray(v)) before[k] = k === 'grid' ? copyGrid(v) : k === 'inserts' ? copyInserts(v) : copyRt(v);
        else if (v && typeof v === 'object') before[k] = { ...v };
        else before[k] = v;
      });
      engine.updateTrack(id, patch);
    },
    undo() {
      if (before) engine.updateTrack(id, before);
    },
  };
}

// Mute/solo/monitor a track (backlog #17/#21). Captures the previous flag so
// undo restores it; the engine re-applies audibility on updateTrack.
export function setTrackFlagCommand(engine, id, key, value) {
  let before = null;
  const label = key === 'muted' ? (value ? 'Mute track' : 'Unmute track')
    : key === 'solo' ? (value ? 'Solo track' : 'Unsolo track')
    : (value ? 'Enable monitor' : 'Disable monitor');
  return {
    label,
    apply() {
      const t = engine.byId[id];
      if (!t) return;
      before = !!t[key];
      engine.updateTrack(id, { [key]: !!value });
    },
    undo() {
      if (before !== null) engine.updateTrack(id, { [key]: before });
    },
  };
}

// Rename a track (backlog #18). Captures the previous name so undo restores it.
// An empty/whitespace name is ignored so a cancelled rename never blanks a track.
export function renameTrackCommand(engine, id, name) {
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!clean) return null;
  let before = null;
  return {
    label: 'Rename track',
    apply() {
      const t = engine.byId[id];
      if (!t) return;
      before = t.name;
      engine.updateTrack(id, { name: clean });
    },
    undo() {
      if (before !== null) engine.updateTrack(id, { name: before });
    },
  };
}

// Reorder a track to a new list position (backlog #19). Captures the original
// index so undo restores it; redo re-applies the target position.
export function reorderTrackCommand(engine, id, toIndex) {
  let before = null;
  const target = Math.max(0, Math.round(toIndex));
  return {
    label: 'Reorder track',
    apply() {
      const t = engine.byId[id];
      if (!t) return;
      before = engine.tracks.indexOf(t);
      if (before >= 0) engine.reorderTrack(id, target);
    },
    undo() {
      if (before !== null) engine.reorderTrack(id, before);
    },
  };
}

export function clearTrackCommand(engine, id) {
  let snapshot = null;
  return {
    label: 'Clear track',
    apply() {
      const t = engine.byId[id];
      if (!t) return;
      snapshot = { grid: copyGrid(t.grid), rt: copyRt(t.rt) };
      engine.clearTrack(id);
    },
    undo() {
      if (snapshot) engine.updateTrack(id, { grid: snapshot.grid, rt: snapshot.rt });
    },
  };
}

// Grid cell toggle. Captures the whole grid so undo restores the exact cell.
export function toggleGridStepCommand(engine, id, step) {
  return {
    label: 'Toggle grid step',
    before: null,
    on: false,
    apply() {
      const t = engine.byId[id];
      if (!t) return;
      this.before = copyGrid(t.grid);
      this.on = engine.toggleGridStep(id, step);
    },
    undo() {
      if (this.before) engine.updateTrack(id, { grid: this.before });
    },
  };
}

// Per-cell note/duration edit.
export function setGridStepCommand(engine, id, step, patch) {
  let before = null;
  return {
    label: 'Edit grid step',
    apply() {
      const t = engine.byId[id];
      if (!t) return;
      before = copyGrid(t.grid);
      engine.setGridStep(id, step, patch);
    },
    undo() {
      if (before) engine.updateTrack(id, { grid: before });
    },
  };
}

// Add a MIDI clip to a track. The clip is created with the SAME id on redo so
// the post-redo state is identical.
export function addClipCommand(engine, id, cfg = {}) {
  return {
    label: 'Add clip',
    createdId: null,
    apply() {
      const clip = engine.addClip(id, this.createdId ? { ...cfg, id: this.createdId } : cfg);
      this.createdId = clip ? clip.id : null;
    },
    undo() {
      if (this.createdId) engine.removeClip(id, this.createdId);
    },
  };
}

export function removeClipCommand(engine, id, clipId) {
  let snapshot = null;
  return {
    label: 'Remove clip',
    apply() {
      const t = engine.byId[id];
      const clip = t && t.clips.find(c => c.id === clipId);
      if (!clip) return;
      snapshot = copyClips([clip])[0];
      engine.removeClip(id, clipId);
    },
    undo() {
      if (snapshot) engine.addClip(id, snapshot);
    },
  };
}

// Move/resize a clip. Captures the pre-edit start/length so undo restores them.
export function moveClipCommand(engine, id, clipId, patch) {
  let before = null;
  return {
    label: 'Move clip',
    apply() {
      const t = engine.byId[id];
      const clip = t && t.clips.find(c => c.id === clipId);
      if (!clip) return;
      before = { start: clip.start, length: clip.length };
      engine.moveClip(id, clipId, patch);
    },
    undo() {
      if (before) engine.moveClip(id, clipId, before);
    },
  };
}

// Split a clip at an absolute timeline tick. Undo restores the original clip
// (length + events) and removes the newly created right-hand clip.
export function splitClipCommand(engine, id, clipId, atTicks) {
  let snapshot = null;   // { start, length, events } of the left clip before split
  let rightId = null;
  return {
    label: 'Split clip',
    apply() {
      const t = engine.byId[id];
      const clip = t && t.clips.find(c => c.id === clipId);
      if (!clip) return;
      snapshot = {
        start: clip.start,
        length: clip.length,
        events: (clip.events || []).map(ev => ({ ...ev })),
      };
      const right = engine.splitClip(id, clipId, atTicks);
      rightId = right ? right.id : null;
    },
    undo() {
      if (rightId) engine.removeClip(id, rightId);
      if (snapshot) engine.moveClip(id, clipId, { start: snapshot.start, length: snapshot.length });
      const t = engine.byId[id];
      const clip = t && t.clips.find(c => c.id === clipId);
      if (clip) clip.events = snapshot.events.map(ev => ({ ...ev }));
    },
  };
}

// Duplicate a clip: a copy is placed right after the original. Undo removes it.
export function duplicateClipCommand(engine, id, clipId) {
  let copyId = null;
  return {
    label: 'Duplicate clip',
    apply() {
      const copy = engine.duplicateClip(id, clipId);
      copyId = copy ? copy.id : null;
    },
    undo() {
      if (copyId) engine.removeClip(id, copyId);
    },
  };
}

// Loop a clip: repeat it `times` times back-to-back. Undo removes the copies.
export function repeatClipCommand(engine, id, clipId, times) {
  let copyIds = [];
  return {
    label: 'Loop clip',
    apply() {
      copyIds = engine.repeatClip(id, clipId, times).map(c => c.id);
    },
    undo() {
      copyIds.forEach(cid => engine.removeClip(id, cid));
    },
  };
}

// Move several clips by the same delta (backlog #15 multi-select). `items` is
// [{ trackId, clipId }]. Undo restores every clip's pre-move start.
export function moveClipsCommand(engine, items, deltaTicks) {
  const snapshots = [];
  return {
    label: 'Move clips',
    apply() {
      snapshots.length = 0;
      (items || []).forEach(({ trackId, clipId }) => {
        const t = engine.byId[trackId];
        const clip = t && t.clips.find(c => c.id === clipId);
        if (!clip) return;
        snapshots.push({ trackId, clipId, before: clip.start });
        engine.moveClip(trackId, clipId, { start: Math.max(0, clip.start + deltaTicks) });
      });
    },
    undo() {
      snapshots.forEach(s => engine.moveClip(s.trackId, s.clipId, { start: s.before }));
    },
  };
}

// Remove several clips in one undoable transaction. Undo re-adds each one.
export function removeClipsCommand(engine, items) {
  const snapshots = [];
  return {
    label: 'Remove clips',
    apply() {
      snapshots.length = 0;
      (items || []).forEach(({ trackId, clipId }) => {
        const t = engine.byId[trackId];
        const clip = t && t.clips.find(c => c.id === clipId);
        if (!clip) return;
        snapshots.push({ trackId, clipId, clip: copyClips([clip])[0] });
        engine.removeClip(trackId, clipId);
      });
    },
    undo() {
      snapshots.forEach(s => engine.addClip(s.trackId, s.clip));
    },
  };
}

// Replace a clip's note events (backlog #25, piano roll). Captures the previous
// events on first apply so undo restores them; redo re-applies the new set.
export function editClipEventsCommand(engine, id, clipId, events) {
  let before = null;
  return {
    label: 'Edit clip notes',
    apply() {
      const t = engine.byId[id];
      const clip = t && t.clips.find(c => c.id === clipId);
      if (!clip) return;
      before = (clip.events || []).map(ev => ({ ...ev }));
      engine.setClipEvents(id, clipId, events);
    },
    undo() {
      if (before !== null) engine.setClipEvents(id, clipId, before);
    },
  };
}

// Attach/detach a clip's audio reference (M4). Captures the previous
// reference on first apply so undo restores it; redo re-applies the new one.
export function setClipAudioCommand(engine, id, clipId, audio) {
  let before = null;
  let applied = false;
  return {
    label: audio ? 'Set clip audio' : 'Clear clip audio',
    apply() {
      const t = engine.byId[id];
      const clip = t && t.clips.find(c => c.id === clipId);
      if (!clip) return;
      if (!applied) {
        before = clip.audio ? { ...clip.audio } : null;
        applied = true;
      }
      engine.setClipAudio(id, clipId, audio);
    },
    undo() {
      if (!applied) return;
      engine.setClipAudio(id, clipId, before);
    },
  };
}

// Insert devices (backlog #32). Commands mutate the descriptor list through the
// engine; TrackVoices rebuilds the audio chain from the list on each apply.
export function addInsertCommand(engine, id, type, params) {
  let createdId = null;
  return {
    label: 'Add ' + type + ' insert',
    apply() {
      const ins = engine.addInsert(id, type, params);
      createdId = ins ? ins.id : null;
    },
    undo() {
      if (!createdId) return;
      const t = engine.byId[id];
      const idx = t && t.inserts.findIndex(i => i.id === createdId);
      if (idx >= 0) engine.removeInsert(id, idx);
    },
  };
}

export function removeInsertCommand(engine, id, index) {
  let snap = null;
  return {
    label: 'Remove insert',
    apply() {
      const t = engine.byId[id];
      const ins = t && t.inserts[index];
      if (!ins) return;
      snap = { index, insert: copyInserts([ins])[0] };
      engine.removeInsert(id, index);
    },
    undo() {
      if (!snap) return;
      const t = engine.byId[id];
      if (!t) return;
      t.inserts.splice(Math.min(snap.index, t.inserts.length), 0, snap.insert);
      if (t.voice && t.voice.rebuildChain) t.voice.rebuildChain();
    },
  };
}

export function updateInsertCommand(engine, id, index, patch) {
  let before = null;
  return {
    label: 'Update insert',
    apply() {
      const t = engine.byId[id];
      const ins = t && t.inserts[index];
      if (!ins) return;
      before = { ...ins.params };
      engine.updateInsert(id, index, patch);
    },
    undo() {
      if (before !== null) engine.updateInsert(id, index, before);
    },
  };
}