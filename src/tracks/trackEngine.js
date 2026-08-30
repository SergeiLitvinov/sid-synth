import { TrackVoices } from './voiceEngine.js';
import { defaultInsertParams } from './inserts.js';
import {
  gridToClipEvents, rtToClipEvents, mergeClipEvents,
  clipEventsToGrid, clipEventsToRt, stepTicks, ticksPerSecond,
} from '../project/clipEvents.js';

export const STEPS_PER_LOOP = 16;
export const NOTE_BEATS = 4;

function defaultClip(cfg = {}) {
  return {
    id: cfg.id || 'clip_' + Math.random().toString(36).slice(2, 8),
    name: cfg.name || 'Clip',
    color: cfg.color || null,
    start: cfg.start === undefined ? 0 : cfg.start,
    length: cfg.length === undefined ? 1920 : cfg.length,
    events: Array.isArray(cfg.events) ? cfg.events.slice() : [],
  };
}

export function defaultTrackConfig(cfg = {}) {
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
    grid: Array.isArray(cfg.grid) ? cfg.grid.slice() : Array(STEPS_PER_LOOP).fill(null),
    rt: Array.isArray(cfg.rt) ? cfg.rt.map(n => ({ ...n })) : [],
    clips: Array.isArray(cfg.clips) ? cfg.clips.map(c => ({ ...c })) : [],
    inserts: Array.isArray(cfg.inserts)
      ? cfg.inserts.map(i => ({ ...i, params: { ...(i.params || {}) } }))
      : [],
  };
}

// Multi-track recorder built on TrackVoices. One 16-step loop (4/4 sixteenths).
// Two event sources per track: a step grid (quantized pattern) and realtime
// notes captured from the keyboard while recording. Both are scheduled with a
// lookahead timer against the Web Audio clock, so they stay sample-accurate.
//
// Grid cells hold `{ note, dur }` (dur in steps, default from track.gridDur) or
// null. Legacy string cells ("C4") are normalized on read, so old saved tracks
// keep working.
export function createTrackEngine(ctx, dest, config = {}) {
  const engine = {
    ctx,
    bpm: config.bpm || 120,
    ppq: config.ppq || 480,
    tracks: [],
    byId: {},
    onTick: config.onTick || null,
    onGridStep: config.onGridStep || null,
    onLoopWrap: config.onLoopWrap || null,
    onStateChange: config.onStateChange || null,
    _nowMs: config.nowMs || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now())),
    _timer: null,
    _playing: false,
    _recording: false,
    _startMs: 0,
    _playStartCtx: 0,
    _loopPos: 0,
    _loopCount: 0,
    _cursor: 0,
    _cursorLoopAbs: 0,
    _armed: new Set(),
    _recBuffer: new Map(), // trackId -> open events [{note,start,dur:null}]
    recordMode: config.recordMode || 'overdub', // 'overdub' | 'replace'
    recordQuantize: config.recordQuantize || null, // { grid, strength, swing } | null
  };

  engine.stepDur = 60 / engine.bpm / NOTE_BEATS;
  engine.loopDur = engine.stepDur * STEPS_PER_LOOP;

  engine._idCount = 0;

  engine.recalcTempo = () => {
    engine.stepDur = 60 / engine.bpm / NOTE_BEATS;
    engine.loopDur = engine.stepDur * STEPS_PER_LOOP;
  };

  // ---- MIDI clips -----------------------------------------------------
  // Backlog #9: the loop clip (clips[0], start 0) is the canonical note store.
  // Grid cells + realtime notes are mirrored into its `events` (PPQ ticks), and
  // a clip-first document (events inside the clip, empty grid/rt) is expanded
  // back into grid/rt so the step scheduler plays unchanged.
  function syncLoopClip(t) {
    if (!t.clips || !t.clips.length) return;
    const loop = t.clips.find(c => c.start === 0) || t.clips[0];
    loop.events = mergeClipEvents(
      gridToClipEvents(t.grid, { ppq: engine.ppq }),
      rtToClipEvents(t.rt, { bpm: engine.bpm, ppq: engine.ppq }),
    );
  }

  // ---- track management ------------------------------------------------
  engine.addTrack = (cfg = {}) => {
    let id = cfg.id;
    if (id) {
      engine._idCount = Math.max(engine._idCount, parseInt(String(id).replace(/\D/g, ''), 10) || 0);
    } else {
      id = 'trk_' + (++engine._idCount);
    }
    const t = defaultTrackConfig({ ...cfg, id });
    const loopClip = (t.clips || []).find(c => c.start === 0);
    if (loopClip && (loopClip.events || []).length) {
      const hasGrid = (t.grid || []).some(c => !!c);
      if (!hasGrid && !(t.rt || []).length) {
        t.grid = clipEventsToGrid(loopClip.events, { ppq: engine.ppq });
        t.rt = clipEventsToRt(loopClip.events, { bpm: engine.bpm, ppq: engine.ppq });
      }
    }
    t.voice = new TrackVoices(engine.ctx, t, dest);
    syncLoopClip(t);
    engine.tracks.push(t);
    engine.byId[t.id] = t;
    _applyAudibility();
    _emitState();
    return t;
  };

  engine.removeTrack = (id) => {
    const t = engine.byId[id];
    if (!t) return;
    const i = engine.tracks.indexOf(t);
    if (i >= 0) engine.tracks.splice(i, 1);
    delete engine.byId[id];
    engine._armed.delete(id);
    try { t.voice.dispose(); } catch (e) {}
    _emitState();
  };

  // Reorder a track to a new position in the track list (backlog #19). The
  // index is clamped to the list bounds; no-op when the track is missing or
  // already at that position. Returns true when the order changed.
  engine.reorderTrack = (id, toIndex) => {
    const t = engine.byId[id];
    if (!t) return false;
    const from = engine.tracks.indexOf(t);
    if (from < 0) return false;
    const target = Math.max(0, Math.min(Math.round(toIndex), engine.tracks.length - 1));
    if (target === from) return false;
    engine.tracks.splice(from, 1);
    engine.tracks.splice(target, 0, t);
    _emitState();
    return true;
  };

  engine.updateTrack = (id, patch) => {
    const t = engine.byId[id];
    if (!t) return;
    Object.keys(patch).forEach(k => {
      if (k === 'adsr') t.adsr = { ...t.adsr, ...patch.adsr };
      else if (k === 'rt') t.rt = Array.isArray(patch.rt) ? patch.rt.map(n => ({ ...n })) : t.rt;
      else if (k === 'clips') t.clips = Array.isArray(patch.clips) ? patch.clips.map(c => ({ ...c })) : t.clips;
      else if (k === 'inserts') t.inserts = Array.isArray(patch.inserts)
        ? patch.inserts.map(i => ({ ...i, params: { ...(i.params || {}) } }))
        : (t.inserts || []);
      else t[k] = patch[k];
    });
    _applyAudibility();
    if ('inserts' in patch && t.voice && t.voice.rebuildChain) t.voice.rebuildChain();
    _emitState();
  };

  // ---- insert devices (backlog #32) -----------------------------------
  // Insert descriptors are plain data `{ id, type, params }` on the track;
  // TrackVoices rebuilds its audio chain (`insertIn → inserts → trackGain`)
  // whenever the list changes. `updateInsert` only touches params — the chain
  // topology is unchanged, so the live device is updated in place.
  engine.addInsert = (id, type, params) => {
    const t = engine.byId[id];
    if (!t) return null;
    const insert = {
      id: 'ins_' + Math.random().toString(36).slice(2, 8),
      type,
      params: { ...defaultInsertParams(type), ...(params || {}) },
    };
    t.inserts.push(insert);
    if (t.voice && t.voice.rebuildChain) t.voice.rebuildChain();
    _emitState();
    return insert;
  };

  engine.removeInsert = (id, index) => {
    const t = engine.byId[id];
    if (!t || !Array.isArray(t.inserts) || !t.inserts[index]) return false;
    t.inserts.splice(index, 1);
    if (t.voice && t.voice.rebuildChain) t.voice.rebuildChain();
    _emitState();
    return true;
  };

  engine.updateInsert = (id, index, patch) => {
    const t = engine.byId[id];
    const ins = t && t.inserts && t.inserts[index];
    if (!ins) return false;
    Object.keys(patch || {}).forEach(k => {
      if (k === 'id' || k === 'type') return;
      ins.params[k] = patch[k];
    });
    if (t.voice && t.voice.applyInsert) t.voice.applyInsert(index);
    _emitState();
    return true;
  };

  // ---- mute / solo ------------------------------------------------------
  // Audibility: a track is inaudible when it is muted, or when some other
  // track is soloed (then only the soloed tracks play). `enabled: false`
  // already gates scheduling; mute/solo adjust the track output gain live.
  // Solo semantics: if ANY track has solo=true, only solo tracks are heard.
  engine._anySolo = () => engine.tracks.some(t => t.solo);

  engine.isAudible = (id) => {
    const t = engine.byId[id];
    if (!t || t.muted) return false;
    if (engine._anySolo()) return !!t.solo;
    return true;
  };

  function _applyAudibility() {
    engine.tracks.forEach(t => {
      const target = engine.isAudible(t.id) ? t.volume : 0;
      if (t.voice && t.voice.setGain) t.voice.setGain(target);
    });
  }

  // ---- MIDI clips -----------------------------------------------------
  // A clip is a block of musical time on a track (`start`/`length` in PPQ ticks).
  // Backlog #9 moves grid/rt events inside clip.events; for now clips are the
  // timeline containers the arranger renders.
  engine.addClip = (id, cfg = {}) => {
    const t = engine.byId[id];
    if (!t) return null;
    const clip = defaultClip(cfg);
    t.clips.push(clip);
    syncLoopClip(t);
    _emitState();
    return clip;
  };

  engine.removeClip = (id, clipId) => {
    const t = engine.byId[id];
    if (!t) return false;
    const i = t.clips.findIndex(c => c.id === clipId);
    if (i < 0) return false;
    t.clips.splice(i, 1);
    _emitState();
    return true;
  };

  // Reposition/resize a clip on the timeline (start/length in PPQ ticks).
  engine.moveClip = (id, clipId, patch = {}) => {
    const t = engine.byId[id];
    const clip = t && t.clips.find(c => c.id === clipId);
    if (!clip) return false;
    if (typeof patch.start === 'number') clip.start = Math.max(0, Math.round(patch.start));
    if (typeof patch.length === 'number') clip.length = Math.max(1, Math.round(patch.length));
    _emitState();
    return true;
  };

  // Replace a clip's note events (backlog #25, piano roll). Events are PPQ ticks
  // relative to the clip start. For the loop clip (start 0) the events also feed
  // the step grid / realtime scheduler, so they are re-quantized into `grid`
  // (16-step) — the loop is inherently one bar of sixteenths, so this keeps the
  // drawn notes lossless; realtime `rt` notes are folded into the grid. Editing
  // an arranged (non-loop) clip never touches grid/rt — the linear scheduler
  // plays its events directly.
  engine.setClipEvents = (id, clipId, events) => {
    const t = engine.byId[id];
    const clip = t && t.clips.find(c => c.id === clipId);
    if (!clip) return false;
    clip.events = (events || []).map(ev => ({ ...ev })).sort((a, b) => (a.start || 0) - (b.start || 0));
    const loop = t.clips.find(c => c.start === 0) || t.clips[0];
    if (clip === loop) {
      t.grid = clipEventsToGrid(clip.events, { ppq: engine.ppq });
      t.rt = [];
    }
    _emitState();
    return true;
  };

  // Split a clip at an absolute timeline tick `atTicks` (must be strictly inside
  // the clip). The clip becomes two clips: the original keeps [start, atTicks),
  // a new clip covers [atTicks, start+length). Events are partitioned by their
  // start tick; events on the right keep their offset from the split point.
  // Returns the new (right) clip, or null when the split point is outside.
  engine.splitClip = (id, clipId, atTicks) => {
    const t = engine.byId[id];
    const clip = t && t.clips.find(c => c.id === clipId);
    if (!clip) return null;
    const cut = Math.max(clip.start, Math.min(Math.round(atTicks), clip.start + clip.length));
    if (cut <= clip.start || cut >= clip.start + clip.length) return null;
    const splitOffset = cut - clip.start;
    const leftEvents = [];
    const rightEvents = [];
    (clip.events || []).forEach(ev => {
      if (ev.start < splitOffset) leftEvents.push({ ...ev });
      else rightEvents.push({ ...ev, start: ev.start - splitOffset });
    });
    const right = defaultClip({
      name: clip.name,
      color: clip.color,
      start: cut,
      length: clip.start + clip.length - cut,
      events: rightEvents,
    });
    clip.length = splitOffset;
    clip.events = leftEvents;
    t.clips.push(right);
    syncLoopClip(t);
    _emitState();
    return right;
  };

  // Duplicate a clip: a copy with the same name/color/events placed immediately
  // after the original. Returns the new clip.
  engine.duplicateClip = (id, clipId) => {
    const t = engine.byId[id];
    const clip = t && t.clips.find(c => c.id === clipId);
    if (!clip) return null;
    const copy = defaultClip({
      name: clip.name,
      color: clip.color,
      start: clip.start + clip.length,
      length: clip.length,
      events: clip.events,
    });
    t.clips.push(copy);
    syncLoopClip(t);
    _emitState();
    return copy;
  };

  // Loop a clip: repeat it `times` times, stacking `times` total occurrences
  // back-to-back starting at the original start. Returns the array of the
  // added copies (empty when times <= 1 or the clip is missing).
  engine.repeatClip = (id, clipId, times) => {
    const t = engine.byId[id];
    const clip = t && t.clips.find(c => c.id === clipId);
    if (!clip) return [];
    const n = Math.max(1, Math.round(times || 1));
    const copies = [];
    for (let i = 1; i < n; i++) {
      const copy = defaultClip({
        name: clip.name,
        color: clip.color,
        start: clip.start + i * clip.length,
        length: clip.length,
        events: clip.events,
      });
      t.clips.push(copy);
      copies.push(copy);
    }
    syncLoopClip(t);
    _emitState();
    return copies;
  };

  engine.selectTrack = (id) => { engine.activeTrackId = id; _emitState(); };
  engine.activeTrackId = engine.activeTrackId || null;

  engine.armTrack = (id, armed) => {
    if (armed) engine._armed.add(id);
    else engine._armed.delete(id);
    _emitState();
  };

  engine.isArmed = (id) => engine._armed.has(id);

  engine.getTracks = () => engine.tracks.map(t => {
    syncLoopClip(t);
    return {
      id: t.id, name: t.name, color: t.color, enabled: t.enabled, monitor: t.monitor, height: t.height || null,
      muted: t.muted, solo: t.solo, folder: t.folder || null, collapsed: !!t.collapsed,
      wave: t.wave, filterType: t.filterType, filterFreq: t.filterFreq, filterQ: t.filterQ,
      adsr: { ...t.adsr }, volume: t.volume, gridNote: t.gridNote, gridDur: t.gridDur,
      midiChannel: typeof t.midiChannel === 'number' ? t.midiChannel : null,
      grid: t.grid.map(c => normalizeCell(c)), rt: t.rt.map(n => ({ ...n })),
      clips: t.clips.map(c => ({ ...c, events: (c.events || []).slice() })),
      inserts: t.inserts.map(i => ({ id: i.id, type: i.type, params: { ...(i.params || {}) } })),
    };
  });

  // Folders (backlog #23): a track is a folder when other tracks reference it
  // via their `folder` id. Collapsing a folder hides its children; collapsing
  // a track without children hides its own lane content (grid row / clips).
  engine.folderChildren = (id) => engine.tracks.filter(t => t.folder === id);
  engine.visibleTracks = () => engine.tracks.filter(t => {
    if (!t.folder) return true;
    const parent = engine.byId[t.folder];
    return !parent || !parent.collapsed;
  });

  engine.getState = () => ({
    playing: engine._playing,
    recording: engine._recording,
    bpm: engine.bpm,
    stepDur: engine.stepDur,
    loopDur: engine.loopDur,
    loopPos: engine._loopPos,
    step: Math.floor((engine._loopPos / engine.stepDur) % STEPS_PER_LOOP),
    activeTrackId: engine.activeTrackId,
  });

// ---- grid editing -----------------------------------------------------
  // Grid cells are `{ note, dur, vel }` or null. `note` is a pitch name like
  // "C4"; `dur` is note length in sixteenth-steps (default 1); `vel` (0-127) is
  // the note velocity the cell was derived from (piano roll, backlog #27).
  function normalizeCell(c) {
    if (!c) return null;
    if (typeof c === 'string') return { note: c, dur: 1 };
    const out = { note: c.note, dur: typeof c.dur === 'number' && c.dur > 0 ? c.dur : 1 };
    if (typeof c.vel === 'number') out.vel = c.vel;
    return out;
  }

  engine.toggleGridStep = (id, step, note, dur) => {
    const t = engine.byId[id];
    if (!t) return false;
    const was = t.grid[step];
    if (was) { t.grid[step] = null; syncLoopClip(t); return false; }
    t.grid[step] = { note: note || t.gridNote || 'C4', dur: dur || t.gridDur || 1 };
    syncLoopClip(t);
    return t.grid[step];
  };

  // Change the pitch and/or duration of an existing grid step.
  engine.setGridStep = (id, step, patch) => {
    const t = engine.byId[id];
    if (!t) return null;
    const cur = normalizeCell(t.grid[step]) || { note: t.gridNote || 'C4', dur: t.gridDur || 1 };
    if (patch.note) cur.note = patch.note;
    if (typeof patch.dur === 'number' && patch.dur > 0) cur.dur = patch.dur;
    t.grid[step] = cur;
    syncLoopClip(t);
    _emitState();
    return cur;
  };

  engine.setGridNote = (id, note) => {
    const t = engine.byId[id];
    if (t) { t.gridNote = note; _emitState(); }
  };

  engine.setGridDur = (id, dur) => {
    const t = engine.byId[id];
    if (t && typeof dur === 'number' && dur > 0) { t.gridDur = dur; _emitState(); }
  };

  engine.clearTrack = (id) => {
    const t = engine.byId[id];
    if (t) { t.grid = Array(STEPS_PER_LOOP).fill(null); t.rt = []; syncLoopClip(t); _emitState(); }
  };

  // ---- transport --------------------------------------------------------
  // Backlog #24: full-song playback. Besides the loop scheduler above, every
  // clip except the loop mirror plays its events once at its absolute timeline
  // position. Per-event `_scheduledLin` flags stop an event from being
  // scheduled twice within one playback session; reset on every start.
  engine._resetLinearPlayback = () => {
    engine.tracks.forEach(t => {
      (t.clips || []).forEach(c => (c.events || []).forEach(ev => delete ev._scheduledLin));
    });
  };

  // Chase: fire noteOn for all sustained notes at the given absolute tick.
  // Called after seek so notes that started before the seek point but haven't
  // ended yet are re-triggered with a truncated duration.
  engine.chaseToTick = (absTick) => {
    if (!engine._playing) return;
    const tps = ticksPerSecond(engine.bpm, engine.ppq);
    const nowAbs = engine._playStartCtx + ((engine._nowMs() - engine._startMs) / 1000);
    const loopLenTicks = STEPS_PER_LOOP * (engine.ppq / 4);
    engine.tracks.forEach(t => {
      if (engine.byId[t.id].enabled === false) return;
      const loopClip = (t.clips || []).find(c => c.start === 0);
      // Loop clip: check events against loop-relative position (ticks)
      if (loopClip) {
        const loopPosTicks = absTick % loopLenTicks;
        (loopClip.events || []).forEach(ev => {
          const evStart = typeof ev.start === 'number' ? ev.start : 0;
          const evDur = typeof ev.dur === 'number' ? ev.dur : 0;
          if (evStart <= loopPosTicks && evStart + evDur > loopPosTicks) {
            const remainingTicks = (evStart + evDur) - loopPosTicks;
            const durSec = remainingTicks / tps;
            t.voice.noteOn(ev.note, nowAbs, durSec, ev.velocity);
          }
        });
      }
      // Arranged clips: check events against absolute position (ticks)
      (t.clips || []).forEach(clip => {
        if (clip === loopClip) return;
        (clip.events || []).forEach(ev => {
          const evStart = typeof ev.start === 'number' ? ev.start : 0;
          const evDur = typeof ev.dur === 'number' ? ev.dur : 0;
          const absStart = clip.start + evStart;
          const absEnd = absStart + evDur;
          if (absStart <= absTick && absEnd > absTick) {
            const remainingTicks = absEnd - absTick;
            const durSec = remainingTicks / tps;
            t.voice.noteOn(ev.note, nowAbs, durSec, ev.velocity);
          }
        });
      });
    });
  };

  engine.play = () => {
    _resumeIfNeeded();
    engine.recalcTempo();
    engine.stopTimer();
    engine._playing = true;
    engine._loopPos = 0;
    engine._loopCount = 0;
    engine._cursor = 0;
    engine._startMs = engine._nowMs();
    engine._playStartCtx = engine.ctx.currentTime + 0.03;
    engine._cursorLoopAbs = engine._playStartCtx;
    engine._resetLinearPlayback();
    engine.tracks.forEach(t => {
      t.rt.forEach(ev => { ev._nextAbs = engine._playStartCtx + ev.start; });
    });
    _emitState();
    _scheduleAhead(0.02);
    engine._timer = setInterval(_tick, 25);
  };

  engine.record = () => {
    if (!engine._armed.size && engine.activeTrackId) engine.armTrack(engine.activeTrackId, true);
    if (engine.recordMode === 'replace') {
      const ids = engine._armed.size ? [...engine._armed] : (engine.activeTrackId ? [engine.activeTrackId] : []);
      ids.forEach(id => _clearLoopClip(engine.byId[id]));
    }
    engine._recording = true;
    engine._recBuffer.clear();
    engine.tracks.forEach(t => t.rt.forEach(ev => delete ev._open));
    _emitState();
    if (!engine._playing) engine.play();
  };

  engine.stop = () => {
    engine._recording = false;
    _commitBuffer(true);
    engine.stopTimer();
    engine._playing = false;
    engine._loopPos = 0;
    engine._loopCount = 0;
    engine.tracks.forEach(t => t.voice.allOff(engine.ctx.currentTime));
    _emitState();
  };

  engine.stopTimer = () => {
    if (engine._timer) { clearInterval(engine._timer); engine._timer = null; }
  };

  function _emitState() {
    if (engine.onStateChange) engine.onStateChange(engine.getState());
  }

  // ---- live notes ------------------------------------------------------
  // Any note-on while the transport runs in record mode is stamped into the
  // armed tracks' realtime buffer; the same note is always monitored through
  // the track voices so the player hears what will be recorded.
  engine.noteOn = (note) => {
    _resumeIfNeeded();
    const resolve = (n) => (n && n.length ? n.toUpperCase() : n);
    const noteName = resolve(note);
    const now = engine.ctx.currentTime;
    if (!engine._armed.size) {
      const target = engine.activeTrackId || (engine.tracks[0] && engine.tracks[0].id);
      if (target && engine.byId[target]) {
        const t = engine.byId[target];
        if (t.monitor) t.voice.noteOn(noteName, now);
      }
      _emitNote(noteName);
      return;
    }
    engine._armed.forEach(id => {
      const t = engine.byId[id];
      if (!t) return;
      t.voice.noteOn(noteName, now);
      if (engine._recording) _stampOn(t, noteName);
    });
    _emitNote(noteName);
  };

  engine.noteOff = (note) => {
    _resumeIfNeeded();
    const resolve = (n) => (n && n.length ? n.toUpperCase() : n);
    const noteName = resolve(note);
    const now = engine.ctx.currentTime;
    const targets = engine._armed.size
      ? [...engine._armed].map(id => engine.byId[id]).filter(Boolean)
      : (() => {
          const id = engine.activeTrackId || (engine.tracks[0] && engine.tracks[0].id);
          return id && engine.byId[id] ? [engine.byId[id]] : [];
        })();
    targets.forEach(t => {
      t.voice.noteOff(noteName, now);
      if (engine._recording) _stampOff(t, noteName);
    });
  };

  // ---- CC / pitch bend routing (backlog #174) ----------------------------
  // Route MIDI CC to matching tracks (by midiChannel).
  engine.routeCC = (channel, cc, value) => {
    const tracks = engine.tracks;
    const matching = tracks.filter(t => t.midiChannel === null || t.midiChannel === channel);
    const norm = value / 127; // 0..1
    matching.forEach(t => {
      if (cc === 1) t.voice.modulation(norm);           // CC1: modulation → filter
      else if (cc === 64) t.voice.sustain(norm >= 0.5); // CC64: sustain pedal
      else if (cc === 7) t.voice.setGain(norm);         // CC7: volume → fader
    });
  };

  // Route MIDI pitch bend to matching tracks.
  engine.routePitchBend = (channel, value) => {
    const tracks = engine.tracks;
    const matching = tracks.filter(t => t.midiChannel === null || t.midiChannel === channel);
    matching.forEach(t => t.voice.pitchBend(value));
  };

  // ---- piano roll audition (backlog #30) ----------------------------------
  // Preview a note through one specific track's voice — the track the selected
  // clip belongs to — bypassing the global live-note routing (active/armed
  // tracks, monitor gating), so drawing and dragging in the piano roll always
  // auditions the instrument being edited. Respects mute/solo audibility;
  // `dur` (seconds) makes the note self-terminating (used when drawing);
  // `when` (absolute ctx time) schedules ahead for one-pass previews (#40).
  engine.auditionNote = (trackId, note, vel, dur, when) => {
    _resumeIfNeeded();
    const resolve = (n) => (n && n.length ? n.toUpperCase() : n);
    const t = engine.byId[trackId];
    if (!t || !engine.isAudible(t.id)) return;
    t.voice.noteOn(resolve(note), typeof when === 'number' ? when : engine.ctx.currentTime, dur, vel);
  };

  engine.auditionNoteOff = (trackId, note) => {
    _resumeIfNeeded();
    const resolve = (n) => (n && n.length ? n.toUpperCase() : n);
    const t = engine.byId[trackId];
    if (!t) return;
    t.voice.noteOff(resolve(note), engine.ctx.currentTime);
  };

  function _emitNote(note) {
    if (engine.onNote) engine.onNote({ note, loopPos: engine._loopPos, loopCount: engine._loopCount });
  }

  function _resumeIfNeeded() {
    if (engine.ctx && engine.ctx.state === 'suspended') {
      try { engine.ctx.resume(); } catch (e) {}
    }
  }

  function _stampOn(t, noteName) {
    const buf = engine._recBuffer.get(t.id) || [];
    const start = _withinLoop();
    buf.push({ note: noteName, start: Math.max(0, start), dur: null });
    engine._recBuffer.set(t.id, buf);
  }

  function _stampOff(t, noteName) {
    const buf = engine._recBuffer.get(t.id) || [];
    const idx = buf.map(e => e.note).lastIndexOf(noteName);
    if (idx < 0) return;
    const e = buf[idx];
    const tEnd = _withinLoop();
    let dur = tEnd - e.start;
    if (dur < 0) dur += engine.loopDur;
    e.dur = Math.max(0.03, dur);
  }

  function _withinLoop() {
    return engine._loopPos;
  }

  function _commitBuffer(finalizeHold) {
    engine._recBuffer.forEach((buf, trackId) => {
      const t = engine.byId[trackId];
      if (!t) return;
      const committed = buf
        .filter(e => e.dur !== null)
        .map(e => ({ note: e.note, start: e.start, dur: e.dur }));
      buf.forEach(e => {
        if (e.dur === null) {
          let dur = engine.loopDur - e.start;
          if (finalizeHold && dur < 0.03 && e.start > 0) dur = 0.03;
          if (dur > 0) committed.push({ note: e.note, start: e.start, dur });
        }
      });
      if (committed.length) {
        let out = committed;
        if (engine.recordQuantize) {
          const tps = (engine.bpm / 60) * engine.ppq;
          const q = engine.recordQuantize;
          out = committed.map(e => {
            const qd = quantizeTick(e.start * tps, engine.ppq, q.grid, q.strength, q.swing);
            return { ...e, start: qd / tps };
          });
        }
        t.rt = out;
      }
    });
    engine._recBuffer.clear();
    engine.tracks.forEach(syncLoopClip);
    if (engine._playing) {
      engine.tracks.forEach(t => t.rt.forEach(ev => { ev._nextAbs = engine._playStartCtx + (engine._loopCount * engine.loopDur) + ev.start; }));
    }
  }

  // Clear a track's loop clip (grid + realtime notes) so a REPLACE-mode record
  // starts from an empty clip. Backlog #41.
  function _clearLoopClip(t) {
    if (!t) return;
    t.grid = t.grid.map(() => null);
    t.rt = [];
    syncLoopClip(t);
  }

  // Snap a recorded note (in PPQ ticks) to the grid; mirrors quantizeStart from
  // src/arranger/quantize.js but kept in the engine layer to avoid a downward
  // import. Used by record quantization (#41) before the note lands on the clip.
  function quantizeTick(start, ppq, grid, strength, swing) {
    grid = grid > 0 ? grid : 1;
    const step = Math.max(1, (ppq / 4) * grid);
    let col = Math.round(start / step);
    if (swing && col % 2 === 1) col += Math.max(0, Math.min(100, swing)) / 100;
    const k = Math.max(0, Math.min(1, strength / 100));
    const target = col * step;
    return Math.max(0, start + (target - start) * k);
  }

  // ---- scheduler ------------------------------------------------------
  function _tick() {
    const elapsed = (engine._nowMs() - engine._startMs) / 1000;
    const loop = Math.floor(elapsed / engine.loopDur);
    const pos = elapsed - loop * engine.loopDur;
    if (loop > engine._loopCount) {
      engine._loopCount = loop;
      if (engine._recording) _commitBuffer(false);
      if (engine.onLoopWrap) engine.onLoopWrap(engine._loopCount);
    }
    engine._loopPos = pos;
    _scheduleAhead(elapsed);
    if (engine.onTick) {
      engine.onTick({
        loopPos: pos,
        step: Math.floor((pos / engine.stepDur) % STEPS_PER_LOOP),
        loopCount: loop,
        playing: true,
      });
    }
  }

  function _scheduleAhead(elapsed) {
    const nowAbs = engine._playStartCtx + elapsed;
    const endAbs = nowAbs + 0.12;

    const scheduleNoteOn = (t, note, timeAbs, durAbs, vel) => {
      if (engine.byId[t.id].enabled === false) return;
      t.voice.noteOn(note, timeAbs, durAbs, vel);
    };

    // --- grid (cursor keeps monotonic advance across loops) ---
    let gridLoopAbs = engine._cursorLoopAbs + Math.floor(engine._cursor / STEPS_PER_LOOP) * engine.loopDur;
    // cursor is always < STEPS_PER_LOOP, so gridLoopAbs === _cursorLoopAbs;
    while (gridLoopAbs + engine._cursor * engine.stepDur < endAbs) {
      const timeAbs = gridLoopAbs + engine._cursor * engine.stepDur;
      engine.tracks.forEach(t => {
        const cell = normalizeCell(t.grid[engine._cursor]);
        if (cell) scheduleNoteOn(t, cell.note, timeAbs, engine.stepDur * Math.max(1, cell.dur) - 0.01, cell.vel);
      });
      if (engine.onGridStep) engine.onGridStep(engine._cursor, timeAbs);
      engine._cursor++;
      if (engine._cursor >= STEPS_PER_LOOP) {
        engine._cursor = 0;
        engine._cursorLoopAbs += engine.loopDur;
        gridLoopAbs = engine._cursorLoopAbs;
      }
    }

    // --- realtime notes (per-event next occurrence pointer) ---
    engine.tracks.forEach(t => {
      t.rt.forEach(ev => {
        if (typeof ev._nextAbs !== 'number') ev._nextAbs = engine._playStartCtx + ev.start;
      });
      t.rt.forEach(ev => {
        while (ev._nextAbs < endAbs) {
          const loopStart = ev._nextAbs - ev.start;
          const offWithin = Math.min(ev.dur || 0, loopStart + engine.loopDur - ev._nextAbs);
          const timeAbs = ev._nextAbs;
          if (ev.dur > 0) {
            if (offWithin > 0.01) {
              scheduleNoteOn(t, ev.note, timeAbs, offWithin, ev.velocity);
            } else {
              scheduleNoteOn(t, ev.note, timeAbs, undefined, ev.velocity);
              t.voice.noteOff(ev.note, timeAbs + Math.max(0.03, engine.loopDur - ev.start));
            }
          } else if (ev.dur === 0) {
            scheduleNoteOn(t, ev.note, timeAbs, undefined, ev.velocity);
            t.voice.noteOff(ev.note, loopStart + engine.loopDur);
          }
          ev._nextAbs += engine.loopDur;
        }
      });
    });

    // --- arranged clips (backlog #24): linear full-song playback ---------
    // Every clip except the loop mirror (the one the grid/rt loop scheduler
    // plays) sounds its events once, positioned at clip.start + ev.start ticks
    // (constant tempo). Events are only scheduled once per play via the
    // per-event _scheduledLin flag; late passes (timer jitter) catch up by
    // scheduling into the past, which the Web Audio clock plays immediately.
    const tps = ticksPerSecond(engine.bpm, engine.ppq);
    engine.tracks.forEach(t => {
      const loopClip = (t.clips || []).find(c => c.start === 0);
      (t.clips || []).forEach(clip => {
        if (clip === loopClip) return;
        (clip.events || []).forEach(ev => {
          if (ev._scheduledLin) return;
          const absTicks = clip.start + (typeof ev.start === 'number' ? ev.start : 0);
          const absSec = absTicks / tps;
          if (absSec > elapsed + 0.12) return;
          const timeAbs = engine._playStartCtx + absSec;
          const durTicks = typeof ev.dur === 'number' ? ev.dur : 0;
          if (durTicks > 0) scheduleNoteOn(t, ev.note, timeAbs, durTicks / tps, ev.velocity);
          else scheduleNoteOn(t, ev.note, timeAbs, undefined, ev.velocity);
          ev._scheduledLin = true;
        });
      });
    });
  }

  // Test-only: overwrite the clock source with a controllable one.
  engine._setClock = (nowMs) => { engine._nowMs = nowMs; };
  // Test-only: drive the lookahead scheduler manually (no interval).
  engine._tick = _tick;
  // Exposed for the transport adapter to finalize realtime buffers on stop.
  engine._commitBuffer = _commitBuffer;

  engine.dispose = () => {
    engine.stopTimer();
    engine._recording = false;
    engine._playing = false;
    engine.tracks.forEach(t => { try { t.voice.dispose(); } catch (e) {} });
    engine.tracks.length = 0;
    engine.byId = {};
  };

  return engine;
}