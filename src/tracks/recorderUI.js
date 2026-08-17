import { STEPS_PER_LOOP } from './trackEngine.js';
import { resolveNote } from '../services/notes.js';
import {
  addTrackCommand, removeTrackCommand, updateTrackCommand, setTrackFlagCommand,
  clearTrackCommand, toggleGridStepCommand, setGridStepCommand,
  renameTrackCommand, reorderTrackCommand,
} from '../project/trackCommands.js';

const WAVES = ['square', 'sawtooth', 'sine', 'triangle', 'noise'];
const FILTERS = ['none', 'lowpass', 'highpass', 'bandpass'];

// Recorder panel: transport (REC / PLAY / STOP / BPM), per-track rows with
// arm/monitor/wave/filter, a 16-step grid editor, and realtime note display.
// All state flows through the TrackEngine; this module only renders + forwards
// DOM events. User edits (add/remove/update/clear/grid) run as undoable
// commands through the optional `history` (createHistory).
export function createRecorderUI({ container, engine, history }) {
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
      <label class="rec-bpm">BPM
        <input type="number" id="recBpm" min="40" max="240" value="${engine.bpm}" step="1">
      </label>
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
  const recNote = el.querySelector('#recNote');
  const recTracks = el.querySelector('#recTracks');
  const recGrid = el.querySelector('#recGrid');
  const recUndo = el.querySelector('#recUndo');
  const recRedo = el.querySelector('#recRedo');

  // Run a command through history when available, else apply directly.
  function runCommand(cmd) {
    if (history) history.execute(cmd);
    else cmd.apply();
  }

  // Currently selected grid step `{ id, step }` (null = none). Selecting a step
  // makes the track-row note/duration inputs edit that exact cell.
  let sel = null;

  recRecord.addEventListener('click', () => {
    engine.record();
  });

  recPlay.addEventListener('click', () => {
    if (engine._playing) engine.stop();
    else engine.play();
  });

  recStop.addEventListener('click', () => engine.stop());

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

      const parts = [arm, mute, solo, mon, up, down, collapse];
      for (const node of [name, colorIn, noteIn, durIn, waveSel, fltSel, clear, del]) parts.push(node);
      parts.forEach(p => row.appendChild(p));
      recTracks.appendChild(row);
    });
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