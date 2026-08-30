import { STEPS_PER_LOOP } from './trackEngine.js';
import { resolveNote } from '../services/notes.js';
import {
  addTrackCommand, removeTrackCommand, updateTrackCommand, setTrackFlagCommand,
  clearTrackCommand, toggleGridStepCommand, setGridStepCommand,
  renameTrackCommand, reorderTrackCommand,
  addInsertCommand, removeInsertCommand, updateInsertCommand,
} from '../project/trackCommands.js';
import { defaultInsertParams } from './inserts.js';

const WAVES = ['square', 'sawtooth', 'sine', 'triangle', 'noise'];
const FILTERS = ['none', 'lowpass', 'highpass', 'bandpass'];

// Recorder panel: transport (REC / PLAY / STOP / BPM), per-track rows with
// arm/monitor/wave/filter, a 16-step grid editor, and realtime note display.
// All state flows through the TrackEngine; this module only renders + forwards
// DOM events. User edits (add/remove/update/clear/grid) run as undoable
// commands through the optional `history` (createHistory).
export function createRecorderUI({ container, engine, history, exportWav, midiApi }) {
  const el = container;
  el.classList.add('recorder');
  el.innerHTML = `
    <div class="panel-title">RECORDER</div>
    <div class="rec-transport">
      <button class="rec-btn" id="recRecord">● REC</button>
      <button class="rec-btn" id="recPlay">▶ PLAY</button>
      <button class="rec-btn" id="recStop">■ STOP</button>
      <button class="rec-btn rec-add" id="recAdd">+ ADD TRACK</button>
      <button class="rec-btn" id="recUndo" title="Undo (Ctrl+Z)" disabled>↶</button>
      <button class="rec-btn" id="recRedo" title="Redo (Ctrl+Y / Ctrl+Shift+Z)" disabled>↷</button>
      <button class="rec-btn" id="recExport" title="Render 4 bars of the loop to a WAV file">WAV</button>
      <label class="rec-bpm">BPM
        <input type="number" id="recBpm" min="40" max="240" value="${engine.bpm}" step="1">
      </label>
      <button class="rec-btn" id="recRecMode" title="Record mode: OVERDUB keeps existing notes, REPLACE clears the clip first">OVERDUB</button>
      <label class="rec-recq" title="Quantize notes as they are recorded">REC Q
        <input type="checkbox" id="recRecQ">
      </label>
      <select class="rec-midi-device" id="recMidiDevice" title="MIDI input device (all devices)">
        <option value="">ALL MIDI</option>
      </select>
      <span class="rec-pos" id="recPos">--</span>
    </div>
    <div class="rec-tracks" id="recTracks"></div>
    <div class="rec-grid" id="recGrid"></div>
    <div class="rec-note" id="recNote">_</div>
  `;

  const recRecord = el.querySelector('#recRecord');
  const recPlay = el.querySelector('#recPlay');
  const recStop = el.querySelector('#recStop');
  const recBpm = el.querySelector('#recBpm');
  const recPos = el.querySelector('#recPos');
  const recRecMode = el.querySelector('#recRecMode');
  const recRecQ = el.querySelector('#recRecQ');
  const recNote = el.querySelector('#recNote');
  const recTracks = el.querySelector('#recTracks');
  const recGrid = el.querySelector('#recGrid');
  const recUndo = el.querySelector('#recUndo');
  const recRedo = el.querySelector('#recRedo');
  const recMidiDevice = el.querySelector('#recMidiDevice');

  // Populate MIDI device selector and sync selection with midiApi.
  function syncMidiDevices() {
    if (!midiApi || !recMidiDevice) return;
    const inputs = midiApi.getInputs();
    const cur = midiApi.getSelectedDeviceId() || '';
    recMidiDevice.innerHTML = '<option value="">ALL MIDI</option>';
    inputs.forEach(inp => {
      const o = document.createElement('option');
      o.value = inp.id;
      o.textContent = inp.name || inp.id;
      if (inp.id === cur) o.selected = true;
      recMidiDevice.appendChild(o);
    });
  }
  if (midiApi) syncMidiDevices();
  if (recMidiDevice) {
    recMidiDevice.addEventListener('change', () => {
      if (midiApi) midiApi.selectDevice(recMidiDevice.value || null);
    });
  }

  // Run a command through history when available, else apply directly.
  function runCommand(cmd) {
    if (history) history.execute(cmd);
    else cmd.apply();
  }

  // Currently selected grid step `{ id, step }` (null = none). Selecting a step
  // makes the track-row note/duration inputs edit that exact cell.
  let sel = null;

  // Expanded insert editors (backlog #32), keyed by track id. Kept across
  // re-renders so toggling INS survives a renderAll().
  const openInserts = new Set();

  recRecord.addEventListener('click', () => {
    engine.record();
  });

  recPlay.addEventListener('click', () => {
    if (engine._playing) engine.stop();
    else engine.play();
  });

  recStop.addEventListener('click', () => engine.stop());

  // Record mode (backlog #41): OVERDUB keeps existing clip notes, REPLACE clears
  // the clip before recording. REC Q toggles record-time quantize. Neither is
  // undoable by itself — only the recorded material is committed to the clip.
  function syncRecControls() {
    recRecMode.textContent = (engine.recordMode === 'replace') ? 'REPLACE' : 'OVERDUB';
    recRecQ.checked = !!engine.recordQuantize;
  }
  recRecMode.addEventListener('click', () => {
    engine.recordMode = engine.recordMode === 'replace' ? 'overdub' : 'replace';
    syncRecControls();
  });
  recRecQ.addEventListener('change', () => {
    engine.recordQuantize = recRecQ.checked ? { grid: 1, strength: 100, swing: 0 } : null;
    syncRecControls();
  });
  syncRecControls();

  const recAdd = el.querySelector('#recAdd');
  recAdd.addEventListener('click', () => {
    const n = engine.tracks.length + 1;
    const cmd = addTrackCommand(engine, { name: 'Track ' + n });
    runCommand(cmd);
    const created = engine.byId[cmd.createdId] || engine.tracks[engine.tracks.length - 1];
    engine.activeTrackId = created.id;
    renderAll();
  });

  recUndo.addEventListener('click', () => { if (history) history.undo(); });
  recRedo.addEventListener('click', () => { if (history) history.redo(); });

  // WAV export (backlog #38): bounce the live mix to a 16-bit WAV and download.
  const recExport = el.querySelector('#recExport');
  recExport.addEventListener('click', async () => {
    if (!exportWav) return;
    if (engine._playing) engine.stop();
    recExport.disabled = true;
    recExport.textContent = '…';
    try {
      const { blob, duration } = await exportWav({ bars: 4, name: 'sid-project' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sid-project.wav';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      recExport.title = 'Rendered ' + duration.toFixed(2) + 's of audio';
    } catch (err) {
      console.error('Export failed', err);
      alert('Export failed: ' + (err && err.message ? err.message : err));
    } finally {
      recExport.disabled = false;
      recExport.textContent = 'WAV';
    }
  });

  if (history) {
    history.onChange(() => {
      const s = history.state();
      recUndo.disabled = !s.canUndo;
      recRedo.disabled = !s.canRedo;
      // If undo removed the active track, fall back to the first remaining one.
      if (engine.activeTrackId && !engine.byId[engine.activeTrackId] && engine.tracks.length) {
        engine.activeTrackId = engine.tracks[0].id;
      }
      renderAll();
    });
  }

  recBpm.addEventListener('change', () => {
    const v = parseInt(recBpm.value, 10);
    if (v >= 40 && v <= 240) { engine.bpm = v; engine.recalcTempo(); }
    else recBpm.value = engine.bpm;
  });

  // ---- rendering ------------------------------------------------------
  function fmtTime(t) {
    const s = Math.floor(t);
    const ms = Math.floor((t - s) * 100);
    return s + '.' + String(ms).padStart(2, '0');
  }

  function renderTracks() {
    recTracks.innerHTML = '';
    engine.getTracks().forEach((t, ti) => {
      const row = document.createElement('div');
      row.className = 'rec-track' + (t.collapsed ? ' collapsed' : '');
      row.style.setProperty('--tcolor', t.color);
      row.dataset.id = t.id;

      const arm = mkBtn('ARM', engine.isArmed(t.id) ? 'armed' : '', () => {
        engine.armTrack(t.id, !engine.isArmed(t.id));
        renderAll();
      });

      const mute = mkBtn('M', t.muted ? 'on mute' : '', () => {
        runCommand(setTrackFlagCommand(engine, t.id, 'muted', !t.muted));
        renderAll();
      });

      const solo = mkBtn('S', t.solo ? 'on solo' : '', () => {
        runCommand(setTrackFlagCommand(engine, t.id, 'solo', !t.solo));
        renderAll();
      });

      // Input monitor (backlog #21): toggling the monitor flag controls whether
      // live notes on this track are heard while recording.
      const mon = mkBtn('MNT', t.monitor ? 'on monitor' : '', () => {
        runCommand(setTrackFlagCommand(engine, t.id, 'monitor', !t.monitor));
        renderAll();
      });

      // Track reorder buttons (backlog #19): move the track up/down in the list
      // as an undoable command. The first/last track's inactive button is hidden.
      const up = mkBtn('▲', '', () => {
        runCommand(reorderTrackCommand(engine, t.id, ti - 1));
        renderAll();
      });
      up.className += ' rec-reorder';
      up.title = 'Move track up';
      if (ti === 0) up.classList.add('dim');
      const down = mkBtn('▼', '', () => {
        runCommand(reorderTrackCommand(engine, t.id, ti + 1));
        renderAll();
      });
      down.className += ' rec-reorder';
      down.title = 'Move track down';
      if (ti === engine.getTracks().length - 1) down.classList.add('dim');

      // Track collapse (backlog #23): folds the track's grid row (and hides the
      // row of any folder children) as an undoable command.
      const collapse = mkBtn(t.collapsed ? '▸' : '▾', t.collapsed ? 'on collapsed' : '', () => {
        runCommand(updateTrackCommand(engine, t.id, { collapsed: !t.collapsed }));
        renderAll();
      });
      collapse.className += ' rec-collapse';
      collapse.title = t.collapsed ? 'Expand track' : 'Collapse track';

      // If a step is selected, the inputs edit that step's note/duration;
      // otherwise they edit the track defaults for newly-toggled steps.
      const selectedCell = sel && sel.id === t.id ? t.grid[sel.step] : null;
      const isEditingStep = !!selectedCell;

      const noteIn = document.createElement('input');
      noteIn.type = 'text';
      noteIn.value = isEditingStep ? selectedCell.note : t.gridNote;
      noteIn.title = isEditingStep ? 'Selected step note' : 'Default grid note';
      noteIn.addEventListener('change', () => {
        const r = resolveNote(noteIn.value.trim().toUpperCase());
        if (!r) { noteIn.value = isEditingStep ? selectedCell.note : t.gridNote; return; }
        if (isEditingStep) runCommand(setGridStepCommand(engine, t.id, sel.step, { note: r }));
        else runCommand(updateTrackCommand(engine, t.id, { gridNote: r }));
        renderAll();
      });

      const durIn = document.createElement('input');
      durIn.type = 'number';
      durIn.min = '0.25';
      durIn.max = '16';
      durIn.step = '0.25';
      durIn.value = isEditingStep ? selectedCell.dur : t.gridDur;
      durIn.title = isEditingStep ? 'Selected step length (steps)' : 'Default note length (steps)';
      durIn.addEventListener('change', () => {
        const v = parseFloat(durIn.value);
        if (!(v >= 0.25 && v <= 16)) { durIn.value = isEditingStep ? selectedCell.dur : t.gridDur; return; }
        if (isEditingStep) runCommand(setGridStepCommand(engine, t.id, sel.step, { dur: v }));
        else runCommand(updateTrackCommand(engine, t.id, { gridDur: v }));
        renderAll();
      });

      const waveSel = document.createElement('select');
      WAVES.forEach(w => {
        const o = document.createElement('option');
        o.value = w; o.textContent = w;
        if (w === t.wave) o.selected = true;
        waveSel.appendChild(o);
      });
      waveSel.addEventListener('change', () => {
        runCommand(updateTrackCommand(engine, t.id, { wave: waveSel.value }));
      });

      const fltSel = document.createElement('select');
      FILTERS.forEach(f => {
        const o = document.createElement('option');
        o.value = f; o.textContent = f;
        if (f === t.filterType) o.selected = true;
        fltSel.appendChild(o);
      });
      fltSel.addEventListener('change', () => {
        runCommand(updateTrackCommand(engine, t.id, { filterType: fltSel.value }));
      });

      const clear = mkBtn('CLR', '', () => { runCommand(clearTrackCommand(engine, t.id)); renderAll(); });
      const del = mkBtn('DEL', '', () => { runCommand(removeTrackCommand(engine, t.id)); renderAll(); });

      // Insert devices (backlog #32): the INS button expands/collapses the
      // insert editor; when any inserts exist the button lights up.
      const ins = mkBtn('INS', t.inserts.length ? 'on' : '', () => {
        if (openInserts.has(t.id)) openInserts.delete(t.id);
        else openInserts.add(t.id);
        renderAll();
      });
      ins.className += ' rec-ins';
      ins.title = 'Insert devices (delay / reverb)';

      const name = document.createElement('span');
      name.className = 'rec-track-name';
      name.textContent = t.name;
      name.title = 'Double-click to rename';
      name.addEventListener('dblclick', () => {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'rec-track-name-input';
        input.value = t.name;
        let done = false;
        const commit = () => {
          if (done) return;
          done = true;
          const v = input.value.trim();
          if (v && v !== t.name) runCommand(renameTrackCommand(engine, t.id, v));
          renderAll();
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') { done = true; renderAll(); }
        });
        input.addEventListener('blur', commit);
        name.replaceWith(input);
        input.focus();
        input.select();
      });

      // Track color (backlog #20): a color input drives the track accent used
      // by the row, the grid label and the arranger lane/clips.
      const colorIn = document.createElement('input');
      colorIn.type = 'color';
      colorIn.className = 'rec-track-color';
      colorIn.value = t.color || '#4af74a';
      colorIn.title = 'Track color';
      colorIn.addEventListener('input', () => {
        runCommand(updateTrackCommand(engine, t.id, { color: colorIn.value }));
        renderAll();
      });

      // MIDI channel selector (backlog #173): null = omni (all channels),
      // 1-16 = specific MIDI channel.
      const midiCh = document.createElement('select');
      midiCh.className = 'rec-midi-ch';
      midiCh.title = 'MIDI channel (Omni = all channels)';
      const omniOpt = document.createElement('option');
      omniOpt.value = ''; omniOpt.textContent = 'Omni';
      midiCh.appendChild(omniOpt);
      for (let ch = 1; ch <= 16; ch++) {
        const o = document.createElement('option');
        o.value = ch; o.textContent = ch;
        if (t.midiChannel === ch) o.selected = true;
        midiCh.appendChild(o);
      }
      midiCh.addEventListener('change', () => {
        const v = midiCh.value === '' ? null : parseInt(midiCh.value, 10);
        runCommand(updateTrackCommand(engine, t.id, { midiChannel: v }));
      });

      const parts = [arm, mute, solo, mon, midiCh, up, down, collapse, ins];
      for (const node of [name, colorIn, noteIn, durIn, waveSel, fltSel, clear, del]) parts.push(node);
      parts.forEach(p => row.appendChild(p));
      recTracks.appendChild(row);
      if (openInserts.has(t.id)) recTracks.appendChild(buildInsertEditor(t));
    });
  }

  // Insert editor panel (backlog #32): add-buttons for each insert type plus
  // one control block per live insert (params + remove).
  function buildInsertEditor(t) {
    const wrap = document.createElement('div');
    wrap.className = 'rec-inserts';

    const label = document.createElement('span');
    label.className = 'rec-inserts-label';
    label.textContent = 'INS';
    wrap.appendChild(label);

    const addDelay = mkBtn('+ DLY', '', () => {
      runCommand(addInsertCommand(engine, t.id, 'delay'));
      renderAll();
    });
    const addReverb = mkBtn('+ RVB', '', () => {
      runCommand(addInsertCommand(engine, t.id, 'reverb'));
      renderAll();
    });
    wrap.appendChild(addDelay);
    wrap.appendChild(addReverb);

    t.inserts.forEach((insert, idx) => wrap.appendChild(buildInsertControl(t, insert, idx)));

    if (!t.inserts.length) {
      const hint = document.createElement('span');
      hint.className = 'rec-inserts-hint';
      hint.textContent = 'no inserts — voice → fader → master';
      wrap.appendChild(hint);
    }
    return wrap;
  }

  function buildInsertControl(t, insert, idx) {
    const box = document.createElement('div');
    box.className = 'rec-insert';

    const name = document.createElement('span');
    name.className = 'rec-insert-name';
    name.textContent = insert.type;
    box.appendChild(name);

    const defs = defaultInsertParams(insert.type);
    Object.keys(defs).forEach(key => {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'rec-insert-param';
      input.min = '0';
      input.max = key === 'feedback' ? '0.9' : '1';
      input.step = '0.05';
      input.value = insert.params[key] === undefined ? defs[key] : insert.params[key];
      input.title = key;
      input.addEventListener('change', () => {
        let v = parseFloat(input.value);
        if (!isFinite(v)) { input.value = insert.params[key] === undefined ? defs[key] : insert.params[key]; return; }
        v = Math.max(parseFloat(input.min), Math.min(parseFloat(input.max), v));
        runCommand(updateInsertCommand(engine, t.id, idx, { [key]: v }));
        renderAll();
      });
      box.appendChild(input);
    });

    const del = mkBtn('✕', '', () => {
      runCommand(removeInsertCommand(engine, t.id, idx));
      renderAll();
    });
    del.className += ' rec-insert-del';
    box.appendChild(del);
    return box;
  }

  function mkBtn(label, cls, fn) {
    const b = document.createElement('button');
    b.className = 'rec-btn ' + (cls || '');
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  function renderGrid() {
    recGrid.innerHTML = '';
    const tracks = engine.getTracks();
    if (!tracks.length) {
      const hint = document.createElement('div');
      hint.className = 'rec-hint';
      hint.textContent = 'Add a track with ADD (you need at least one).';
      recGrid.appendChild(hint);
      return;
    }
    // header: step numbers
    const header = document.createElement('div');
    header.className = 'rec-row rec-head';
    const spacer = document.createElement('span');
    spacer.className = 'rec-row-label';
    header.appendChild(spacer);
    for (let s = 0; s < STEPS_PER_LOOP; s++) {
      const c = document.createElement('span');
      c.className = 'rec-step-h';
      c.textContent = s + 1;
      header.appendChild(c);
    }
    recGrid.appendChild(header);

    tracks.forEach(t => {
      // A collapsed track without children hides its own grid row; a collapsed
      // folder hides the rows of its children but stays visible (backlog #23).
      const parent = t.folder ? engine.byId[t.folder] : null;
      const hiddenByParent = parent && parent.collapsed;
      const selfCollapsed = t.collapsed && !engine.folderChildren(t.id).length;
      if (selfCollapsed || hiddenByParent) return;
      // active track is the one selected on the rack / recorded into
      const row = document.createElement('div');
      row.className = 'rec-row';
      const label = document.createElement('span');
      label.className = 'rec-row-label';
      label.textContent = t.name;
      label.style.color = t.color;
      row.appendChild(label);
      for (let s = 0; s < STEPS_PER_LOOP; s++) {
        const cell = t.grid[s];
        const c = document.createElement('div');
        c.className = 'rec-cell';
        if (cell) c.classList.add('on');
        if (cell) {
          c.textContent = cell.note + (cell.dur > 1 ? '·' + cell.dur : '');
          c.title = cell.note + ' · ' + cell.dur + (cell.dur === 1 ? ' step' : ' steps');
        } else {
          c.textContent = '';
          c.title = 'toggle';
        }
        if (sel && sel.id === t.id && sel.step === s) c.classList.add('sel');
        c.addEventListener('click', () => {
          const cmd = toggleGridStepCommand(engine, t.id, s);
          runCommand(cmd);
          sel = cmd.on ? { id: t.id, step: s } : null;
          renderAll();
        });
        row.appendChild(c);
      }
      recGrid.appendChild(row);
    });
  }

  function renderPos() {
    const s = engine.getState();
    if (s.playing) {
      recPos.textContent = fmtTime(s.loopPos) + 's / stp ' + (s.step + 1);
      // highlight current grid column
      const steps = [...recGrid.querySelectorAll('.rec-row:not(.rec-head)')];
      steps.forEach((row, ri) => {
        const cells = [...row.querySelectorAll('.rec-cell')];
        cells.forEach((c, ci) => {
          c.classList.toggle('playhead', ci === s.step);
        });
      });
    }
  }

  function renderAll() {
    // Reflect the engine tempo in the UI unless the user is actively editing it.
    if (recBpm && document.activeElement !== recBpm) recBpm.value = engine.bpm;
    renderTracks();
    renderGrid();
  }

  renderAll();

  // ---- engine callbacks ------------------------------------------------
  engine.onStateChange = (s) => {
    recRecord.classList.toggle('on', s.recording);
    recPlay.classList.toggle('on', s.playing);
    // re-render track rows so ARM buttons reflect engine state (auto-arm on REC)
    renderTracks();
    if (s.playing) renderPos();
    else recPos.textContent = '--';
  };

  engine.onTick = (t) => {
    if (engine._playing) renderPos();
  };

  engine.onGridStep = (step, timeAbs) => {
    // no-op; playhead handled by onTick
  };

  engine.onLoopWrap = () => {};

  engine.onNote = ({ note, loopPos }) => {
    recNote.textContent = note + ' @' + fmtTime(loopPos) + 's';
  };

  // keep rendering in sync whenever state mutates (add/arm/grid edits)
  const origAddTrack = engine.addTrack;
  engine.addTrack = (cfg) => {
    const t = origAddTrack(cfg);
    renderAll();
    return t;
  };

  return {
    el,
    renderAll,
    addTrack(cfg) { return engine.addTrack(cfg); },
  };
}