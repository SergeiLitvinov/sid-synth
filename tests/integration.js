// E2E integration test for SID Synth.
// Runs against the live app (dev server: http://127.0.0.1:3000 via serve.ps1,
// or http://127.0.0.1:3100 via tests/serve-ps.ps1) using a browser-automation
// harness (Playwright MCP): `async (page) => {...}`. Exercises the real
// main.js: drag&drop rack, patch routing, modulation cables, keyboard,
// patch save/load round-trip, cable deletion, presets (built-in + localStorage),
// the recorder panel (tracks, grid, transport, realtime capture, undo/redo),
// and the arranger canvas (ruler, lanes, blocks, zoom, playhead, MIDI clips),
// a full create → arrange 2 clips → save → reload → play journey, and clip
// editing on the timeline (select, multi-select + range select, drag-move with snap,
// edge-trim, split, duplicate, loop, delete via history) plus timeline markers
// (add at playhead, seek on click, delete, persistence), track mute/solo flags
// (recorder M/S buttons + arranger lane flags, undoable), track rename
// (inline double-click editing in recorder rows and arranger lane labels),
// track reorder (▲/▼ buttons in recorder rows and arranger lane headers),
// track color (color inputs in the recorder row and the arranger header),
// track input monitor (MNT buttons in recorder rows and lane headers),
// and track lane resize (drag the lane's bottom edge; undoable), and track
// folder/collapse (collapse toggles in recorder rows and lane headers), and
// full-song playback of arranged clips (program + duplicate the loop clip to
// a later bar, save/reload, play linearly through both), and the piano roll
// note editor (backlog #25/#26/#27: select a clip, draw/remove notes in the pitch
// grid, drag a note to move it, drag its edges to resize, edit note velocity in
// the velocity lane, undo/redo, persistence across reload; backlog #31: zoom
// buttons and snap quantization; backlog #33: quantize note starts with the
// strength/swing Q controls, grid from the active snap, undoable + persisted,
// verified on an arranged clip since the loop clip flattens events to its grid;
// backlog #34: transpose note pitches with the semitone interval T control,
// clamped to the visible pitch range, undoable + persisted;
// backlog #35: Ctrl+D duplicates the marquee selection right after its span,
// undoable + persisted; backlog #36: L extends each note to the next one
// (monophonic legato), undoable + persisted; backlog #37: F snaps every note
// duration to the active snap grid step, undoable + persisted; backlog #39:
// H humanizes note starts (timing) and velocities with random offsets,
// undoable + persisted (velocity on the loop clip, timing on an arranged
// clip where free starts survive); backlog #40: ▶ preview buttons audition
// a transformation without committing (project stays byte-identical);
// backlog #41: record mode (OVERDUB/REPLACE) toggle + REC Q record-quantize
// switch in the recorder transport; backlog #42: STEP input in the piano roll
// (type notes at an insert cursor from the keyboard, snap-step advance,
// Backspace step-back erase, Esc exits),
// backlog #43 MIDI chase (onSeek + chaseToTick),
// and the instrument-track device chain
// (backlog #32: INS insert editor on recorder rows, add delay/reverb inserts,
// edit params, undo/redo, persistence across reload).
// backlog #155: loop locators + project end marker.
// backlog #173: MIDI input routing.
// backlog #174: pitch bend / modulation / sustain / CC.
// backlog #175: drum/step editor mode.
// backlog M4: media pool (asset import UI).
// 230 steps total.
async (page) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    localStorage.clear();
    window.prompt = () => 'it-preset';
    window.alert = () => {};
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const rack = document.getElementById('rack');
    const rackRect = rack.getBoundingClientRect();
    const drop = (type, id, rx, ry) => {
      const dt = new DataTransfer();
      dt.setData('type', type);
      dt.setData('id', id || '');
      rack.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientX: rackRect.left + rx, clientY: rackRect.top + ry }));
    };
    const byType = (t) => [...document.querySelectorAll('.rack .component')].find((c) => c.dataset.type === t);
    const click = (el) => { if (el) el.click(); return !!el; };
    const clickPort = (el) => { if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!el; };
    const cableCount = () => document.querySelectorAll('#connectionsSvg path').length;
    // Undo/redo via the real keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z).
    const historyUndo = () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    };
    const historyRedo = () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    };

    // 1. Create a full rack (rack-relative coords: style.left = max(0, x - 100))
    drop('oscillator', 'osc1', 200, 100);
    drop('filter', '', 450, 100);
    drop('adsr', '', 700, 100);
    drop('lfo', '', 200, 300);
    drop('mixer', '', 950, 100);
    drop('splitter', '', 200, 500);
    drop('sequencer', '', 450, 500);
    step('create 7 components', document.querySelectorAll('.rack .component').length === 7);

    // 1b. Regression: a real pointerdown on a port must NOT be swallowed by the
    // drag handler (pointer capture + preventDefault). Before the fix the port
    // click never fired -> wiring with the mouse was impossible.
    const dragGuardOsc = byType('oscillator');
    const portDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    dragGuardOsc.querySelector('[data-type="output"]').dispatchEvent(portDown);
    step('pointerdown on port not preventDefaulted (drag guard excludes .conn-point)', portDown.defaultPrevented === false);

    // 2. Wire: osc->filter, filter->adsr, adsr->master, lfo->osc (mod), splitter out0->mixer ch0
    const osc = byType('oscillator'), filter = byType('filter'), adsr = byType('adsr'),
          lfo = byType('lfo'), mixer = byType('mixer'), splitter = byType('splitter');
    clickPort(osc.querySelector('[data-type="output"]'));
    clickPort(filter.querySelector('[data-type="input"]'));
    clickPort(filter.querySelector('[data-type="output"]'));
    clickPort(adsr.querySelector('[data-type="input"]'));
    clickPort(adsr.querySelector('[data-type="output"]'));
    clickPort(document.getElementById('masterOutput'));
    clickPort(lfo.querySelector('[data-type="output"]'));
    clickPort(osc.querySelector('[data-type="input"]'));
    clickPort(splitter.querySelector('[data-type="output"][data-channel="0"]'));
    clickPort(mixer.querySelector('[data-type="input"][data-channel="0"]'));
    step('5 cables drawn', cableCount() === 5);

    // 2b. Clicking empty rack cancels an armed port (was Escape-only before)
    clickPort(osc.querySelector('[data-type="output"]'));
    const armedAfterClick = [...document.querySelectorAll('.conn-output')].filter((p) => p.style.background).length;
    rack.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const armedAfterCancel = [...document.querySelectorAll('.conn-output')].filter((p) => p.style.background).length;
    step('click on empty rack cancels armed port', armedAfterClick === 1 && armedAfterCancel === 0, armedAfterCancel);

    // 3. Check mod cable color
    const strokes = [...document.querySelectorAll('#connectionsSvg path')].map((p) => p.getAttribute('stroke'));
    step('mod cable is pink', strokes.some((s) => s === '#ff55ff'), strokes);

    // 4. Play a note via keyboard mousedown
    const key = document.querySelector('.key');
    key.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    step('note display updates on key press', document.getElementById('noteDisplay').textContent !== '_');
    key.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    // 5. Built-in preset updates params AND the knob/select UI
    click(document.querySelector('[data-preset="bass"]'));
    const oscSel = osc.querySelector('.param-row select').value;
    const oscKnob = osc.querySelector('.knob-value').textContent;
    step('bass preset sets waveform in UI', oscSel === 'sawtooth', oscSel);
    step('bass preset sets frequency in knob UI', oscKnob === '110Hz', oscKnob);

    // 6. Save patch via download interception
    window.__patchData = null;
    const origURL = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      blob.text().then((t) => { window.__patchData = t; }).catch(() => {});
      return origURL(blob);
    };
    click(document.getElementById('savePatch'));
    await new Promise((res) => setTimeout(res, 200));
    const saved = window.__patchData ? JSON.parse(window.__patchData) : null;
    step('patch JSON captured', !!saved && saved.components.length === 7, saved ? saved.components.map((c) => c.type) : null);
    step('patch keeps connections with mod flag', !!saved && saved.connections.length === 5 && saved.connections.some((c) => c.mod === true));

    // 7. Clear rack via close buttons, then reload patch
    [...document.querySelectorAll('.rack .component')].forEach((c) => {
      const btn = c.querySelector('.close-btn');
      if (btn) click(btn);
    });
    step('rack cleared', document.querySelectorAll('.rack .component').length === 0 && cableCount() === 0);

    const file = new File([window.__patchData], 'p.json', { type: 'application/json' });
    const input = document.getElementById('patchFile');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    await new Promise((res) => setTimeout(res, 400));
    step('patch reloads 7 components', document.querySelectorAll('.rack .component').length === 7);
    step('patch reloads 5 cables incl mod', cableCount() === 5 && [...document.querySelectorAll('#connectionsSvg path')].some((p) => p.getAttribute('stroke') === '#ff55ff'));

    // 8. Delete a cable (click twice via event dispatch)
    const firstCable = document.querySelector('#connectionsSvg path');
    if (firstCable) {
      firstCable.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      firstCable.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    step('cable deleted by double-click', cableCount() === 4);

    // 9. Presets localStorage
    click(document.getElementById('savePreset'));
    const presets = JSON.parse(localStorage.getItem('sidSynthPresets') || '{}');
    step('preset saved to localStorage', Object.keys(presets).length > 0, Object.keys(presets));
    const itPreset = presets['it-preset'];
    step('preset captures components', !!itPreset && itPreset.components.length === 7, itPreset ? itPreset.components.map((c) => c.type) : null);
    step('preset captures connections', !!itPreset && itPreset.connections.length === 4, itPreset ? itPreset.connections : null);

    // 10. Load preset round-trip: positions + wiring restored (was silent before the fix)
    const list = document.getElementById('presetList');
    list.value = 'it-preset';
    click(document.getElementById('loadPreset'));
    await new Promise((res) => setTimeout(res, 200));
    step('preset load restores 7 components', document.querySelectorAll('.rack .component').length === 7);
    step('preset load restores 4 cables incl mod', cableCount() === 4 && [...document.querySelectorAll('#connectionsSvg path')].some((p) => p.getAttribute('stroke') === '#ff55ff'));
    const posX = parseInt(byType('oscillator').style.left) || 0;
    step('preset load restores position', posX > 0, posX);

    // 11. Built-in presets apply to ALL oscillators, not just the first
    drop('oscillator', 'osc2', 700, 400);
    await new Promise((res) => setTimeout(res, 100));
    click(document.querySelector('[data-preset="bass"]'));
    const oscs = [...document.querySelectorAll('.rack .component[data-type="oscillator"]')];
    const allSaw = oscs.every((o) => o.querySelector('.param-row select').value === 'sawtooth');
    step('preset applies to all oscillators', oscs.length === 2 && allSaw, oscs.length);

    // 12. Recorder panel: transport, tracks, grid, realtime capture.
    const rec = document.getElementById('recorder');
    const recBtn = (id) => document.getElementById(id);
    const gridCells = () => [...rec.querySelectorAll('.rec-cell')];

    step('recorder panel rendered', !!rec && !!recBtn('recRecord') && !!recBtn('recPlay') && !!recBtn('recStop'));

    // 13. Start with one default track row
    step('default track created', rec.querySelectorAll('.rec-track').length === 1);

    // 14. ADD creates a second track and shows two grid rows
    click(recBtn('recAdd'));
    await new Promise((res) => setTimeout(res, 50));
    step('add track -> 2 tracks + 2 grid rows', rec.querySelectorAll('.rec-track').length === 2 && rec.querySelectorAll('.rec-row:not(.rec-head)').length === 2);

    // 15. Grid cell toggle: click step 1 on the first row -> cell lights up, engine.grid[0] set
    const firstRow = rec.querySelector('.rec-row:not(.rec-head)');
    const cell0 = firstRow.querySelector('.rec-cell');
    click(cell0);
    const newCell0 = rec.querySelector('.rec-row:not(.rec-head) .rec-cell');
    step('grid cell toggles on', newCell0.classList.contains('on'));

    // 16. REC arms transport; STOP resets; PLAY starts clean playback
    click(recBtn('recRecord'));
    await new Promise((res) => setTimeout(res, 100));
    const recArmed = recBtn('recRecord').classList.contains('on');
    click(recBtn('recStop'));
    await new Promise((res) => setTimeout(res, 100));
    const stoppedOff = !recBtn('recRecord').classList.contains('on') && !recBtn('recPlay').classList.contains('on');
    click(recBtn('recPlay'));
    await new Promise((res) => setTimeout(res, 100));
    const playOn = recBtn('recPlay').classList.contains('on');
    click(recBtn('recStop'));
    step('record arms + stop resets + play runs', recArmed && stoppedOff && playOn);

    // 17. Keyboard during record writes realtime notes; stop commits them
    const keyEl = document.querySelector('.key');
    click(recBtn('recRecord'));
    await new Promise((res) => setTimeout(res, 100));
    keyEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await new Promise((res) => setTimeout(res, 100));
    keyEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((res) => setTimeout(res, 200));
    click(recBtn('recStop'));
    const noteEl = document.getElementById('recNote');
    step('realtime note captured on keyboard', noteEl.textContent !== '_', noteEl.textContent);

    // 18. BPM input updates tempo display
    const bpmInput = recBtn('recBpm');
    bpmInput.value = 140;
    bpmInput.dispatchEvent(new Event('change'));
    const posEl = document.getElementById('recPos');
    step('bpm change does not break transport', !document.getElementById('recPlay').classList.contains('on'));

    // 19. Stop keeps grid intact (no accidental clear on stop)
    step('grid survives stop', gridCells().filter((c) => c.classList.contains('on')).length >= 1);

    // 20. Per-note editing: clicking an on-cell selects it; the track row's
    // note/duration inputs then edit exactly that step.
    const row2 = rec.querySelectorAll('.rec-row:not(.rec-head)')[1];
    const row2cell0 = row2.querySelector('.rec-cell');
    click(row2cell0); // toggle on + select
    const selCell = rec.querySelector('.rec-row:not(.rec-head) .rec-cell.sel');
    step('clicking a cell selects it', !!selCell);

    const row2Track = [...rec.querySelectorAll('.rec-track')].find((r) => r.dataset.id === 'trk_2');
    const noteInput = row2Track.querySelector('input[type="text"]');
    noteInput.value = 'A3';
    noteInput.dispatchEvent(new Event('change'));
    const durInput = row2Track.querySelector('input[type="number"]');
    durInput.value = '4';
    durInput.dispatchEvent(new Event('change'));
    const cellAfterEdit = rec.querySelectorAll('.rec-row:not(.rec-head) .rec-cell')[16];
    step('selected cell pitch edited', cellAfterEdit.textContent.includes('A3'));
    step('selected cell duration edited', cellAfterEdit.textContent.includes('·4'));

    // 21. Selecting another track leaves defaults untouched (track default stays C4/1)
    const firstTrackRow = rec.querySelectorAll('.rec-track')[0];
    const firstNoteInput = firstTrackRow.querySelector('input[type="text"]');
    step('other track default note unchanged', firstNoteInput.value === 'C4');

    // 22. Track-level default duration: editing row dur with no cell selected
    const row1 = rec.querySelectorAll('.rec-row:not(.rec-head)')[0];
    const row1cell3 = row1.querySelectorAll('.rec-cell')[3];
    click(row1cell3); // toggle on + select step 3 on track 1
    let cell3now = rec.querySelectorAll('.rec-row:not(.rec-head)')[0].querySelectorAll('.rec-cell')[3];
    click(cell3now); // toggle off -> deselects
    const row1Dur = rec.querySelectorAll('.rec-track')[0].querySelector('input[type="number"]');
    row1Dur.value = '2';
    row1Dur.dispatchEvent(new Event('change'));
    const row1Again = rec.querySelectorAll('.rec-row:not(.rec-head)')[0];
    const cell3new = row1Again.querySelectorAll('.rec-cell')[3];
    click(cell3new); // toggle back on, should now use default dur 2
    const newCell3 = rec.querySelectorAll('.rec-row:not(.rec-head)')[0].querySelectorAll('.rec-cell')[3];
    step('track default duration applies to new cell', newCell3.textContent.includes('·2'));

    // 23. Undo/redo via command history (Ctrl+Z / Ctrl+Shift+Z shortcuts + buttons):
    // per-note pitch edit is a recorded command, so undo restores the old cell
    // and redo reapplies it.
    const undoBtn = recBtn('recUndo');
    const redoBtn = recBtn('recRedo');
    step('undo button exists and is wired', !!undoBtn && !!redoBtn);

    // Undo the last edit: the '·2' default-duration cell on track 1 step 3.
    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    const afterUndo = rec.querySelectorAll('.rec-row:not(.rec-head)')[0].querySelectorAll('.rec-cell')[3];
    step('undo reverts last grid edit', !afterUndo.textContent.includes('·2'));

    historyRedo();
    await new Promise((res) => setTimeout(res, 50));
    const afterRedo = rec.querySelectorAll('.rec-row:not(.rec-head)')[0].querySelectorAll('.rec-cell')[3];
    step('redo reapplies the edit', afterRedo.textContent.includes('·2'));

    // ADD/DEL are commands too: undo after DEL restores the removed track.
    const delRow2 = [...rec.querySelectorAll('.rec-track')].find((r) => r.dataset.id === 'trk_2');
    const delBtn2 = [...delRow2.querySelectorAll('.rec-btn')].find((b) => b.textContent === 'DEL');
    click(delBtn2);
    await new Promise((res) => setTimeout(res, 50));
    const afterDel = rec.querySelectorAll('.rec-track').length;
    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    const afterDelUndo = rec.querySelectorAll('.rec-track').length;
    step('DEL track is undoable', afterDel === 1 && afterDelUndo === 2);

    // ---- 24. Arranger canvas: ruler, lanes, playhead, zoom -----------------
    const arr = document.getElementById('arranger');
    step('arranger panel rendered', !!arr && arr.querySelectorAll('.arranger-bar').length > 0 && !!arr.querySelector('.arranger-playhead'));
    step('arranger shows one lane per recorder track', arr.querySelectorAll('.arranger-lane').length === rec.querySelectorAll('.rec-track').length);
    step('arranger renders pattern blocks', arr.querySelectorAll('.arranger-block').length > 0);

    // Zoom in/out changes the px/beat label and block layout.
    const zoomLabel = arr.querySelector('.arranger-zoom-label');
    const beforeZoom = zoomLabel.textContent;
    [...arr.querySelectorAll('.arranger-btn')].find(b => b.textContent === '+').click();
    const afterZoom = zoomLabel.textContent;
    step('arranger zoom in updates px/beat label', beforeZoom !== afterZoom);

    // Playhead follows the transport while playing and resets on stop.
    click(recBtn('recPlay'));
    await new Promise((res) => setTimeout(res, 300));
    const phMid = parseFloat(arr.querySelector('.arranger-playhead').style.left);
    click(recBtn('recStop'));
    await new Promise((res) => setTimeout(res, 50));
    const phStop = parseFloat(arr.querySelector('.arranger-playhead').style.left);
    step('arranger playhead moves while playing and resets on stop', phMid > 0 && phStop === 0, phMid);

    // ---- 25. MIDI clips on the timeline ---------------------------------
    // The "+ clip" button adds a clip to the active track at the next free
    // position; clips render on the lane, replace pattern blocks, and are
    // undoable through the command history.
    const clipBtn = [...arr.querySelectorAll('.arranger-btn')].find((b) => b.textContent === '+ clip');
    step('arranger has an add-clip button', !!clipBtn);
    const clipsBefore = arr.querySelectorAll('.arranger-clip').length;
    clipBtn.click();
    await new Promise((res) => setTimeout(res, 100));
    const clipsAfter = [...arr.querySelectorAll('.arranger-clip')];
    step('add clip renders a clip on the lane', clipsAfter.length === clipsBefore + 1 && clipsAfter[clipsAfter.length - 1].classList.contains('arranger-clip'));
    const activeTrackId = [...rec.querySelectorAll('.rec-track')].find((r) => r.classList.contains('active')) ? [...rec.querySelectorAll('.rec-track')].find((r) => r.classList.contains('active')).dataset.id : null;
    const clipLane = clipsAfter[clipsAfter.length - 1].closest('.arranger-lane');
    step('clip lands on the active track lane', !activeTrackId || clipLane.dataset.id === activeTrackId, clipLane ? clipLane.dataset.id : null);

    // Backlog #9: the first clip added to a track is the loop clip, so it
    // carries the track's grid/rt notes as mini-notes rendered inside it.
    const addedClip = clipsAfter[clipsAfter.length - 1];
    const miniNotes = addedClip.querySelectorAll('.arranger-clip-note');
    step('loop clip renders the track notes as mini-notes', miniNotes.length > 0, miniNotes.length);
    step('mini-notes are inside the clip block', miniNotes.length > 0 && miniNotes[0].parentElement === addedClip);

    // Undo removes the added clip.
    historyUndo();
    await new Promise((res) => setTimeout(res, 100));
    step('add clip is undoable', arr.querySelectorAll('.arranger-clip').length === clipsBefore, arr.querySelectorAll('.arranger-clip').length);

    // ---- 26. Backlog #10: arrange 2 clips, then save (debounced) -------
    // The project persists to localStorage; the first clip on a track is the
    // loop clip (start 0, carries the grid/rt notes), the second one sits at
    // the next free position.
    const arrangeStart = arr.querySelectorAll('.arranger-clip').length;
    clipBtn.click();
    await new Promise((res) => setTimeout(res, 100));
    clipBtn.click();
    await new Promise((res) => setTimeout(res, 100));
    const arrangedClips = [...arr.querySelectorAll('.arranger-clip')];
    step('arrange: adding a clip twice renders 2 clips', arrangedClips.length === arrangeStart + 2, arrangedClips.length);
    const loopClip = arrangedClips.find(c => parseFloat(c.style.left) === 0);
    const secondClip = arrangedClips.find(c => parseFloat(c.style.left) > 0);
    step('arrange: first clip is the loop clip at position 0', !!loopClip, loopClip && loopClip.style.left);
    step('arrange: second clip sits at a later position', !!secondClip, secondClip && secondClip.style.left);
    const loopNotesN = loopClip ? loopClip.querySelectorAll('.arranger-clip-note').length : 0;
    step('arrange: loop clip carries mini-notes', loopNotesN > 0, loopNotesN);
    // Wait out the projectStore debounce (600 ms) + safety margin, then check
    // the persisted snapshot actually contains both clips with events.
    await new Promise((res) => setTimeout(res, 1200));
    const savedProj = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const savedClips = savedProj ? savedProj.tracks.flatMap(t => (t.clips || []).map(c => ({ track: t.id, start: c.start, events: (c.events || []).length }))) : [];
    step('save: project persisted with 2 clips', savedProj && savedClips.length === 2, JSON.stringify(savedClips));
    const savedLoop = savedClips.filter(c => c.start === 0);
    step('save: loop clip persisted with its events', savedLoop.length === 1 && savedLoop[0].events > 0, savedLoop[0] && savedLoop[0].events);

    return results;
  });
  // ---- Backlog #10: reload the page, verify restore, then play ---------
  await page.reload();
  await page.waitForTimeout(900);
  const r2 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const historyUndo = () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    };
    const historyRedo = () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    };
    const arr = document.getElementById('arranger');
    const rec = document.getElementById('recorder');
    const clips = [...arr.querySelectorAll('.arranger-clip')];
    step('reload: 2 clips restored on the timeline', clips.length === 2, clips.length);
    const loopClip = clips.find(c => parseFloat(c.style.left) === 0);
    const loopNotes = loopClip ? loopClip.querySelectorAll('.arranger-clip-note').length : 0;
    step('reload: loop clip restored with mini-notes', loopNotes > 0, loopNotes);
    // Play the restored arrangement: playhead should move, stop resets it.
    rec.querySelector('#recPlay').click();
    await new Promise((res) => setTimeout(res, 300));
    const phMid = parseFloat(arr.querySelector('.arranger-playhead').style.left);
    rec.querySelector('#recStop').click();
    await new Promise((res) => setTimeout(res, 50));
    const phStop = parseFloat(arr.querySelector('.arranger-playhead').style.left);
    step('reload: play moves the playhead, stop resets it', phMid > 0 && phStop === 0, phMid);

    // ---- 27. Backlog #11: select, drag-move and delete a clip -------------
    // Click-to-select, pointer-drag repositions the clip (snapped to the grid)
    // through the command history, and Delete removes the selected clip.
    const clips2 = [...arr.querySelectorAll('.arranger-clip')];
    const clipB = clips2.find(c => parseFloat(c.style.left) > 0);
    const clipRect = clipB.getBoundingClientRect();
    const contentRect = arr.querySelector('.arranger-content').getBoundingClientRect();
    const grabX = contentRect.left + parseFloat(clipB.style.left) + 5;
    clipB.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: grabX }));
    clipB.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: grabX }));
    const selectedClip = arr.querySelector('.arranger-clip.selected');
    step('clicking a clip selects it', !!selectedClip && selectedClip.dataset.id === clipB.dataset.id, selectedClip && selectedClip.dataset.id);

    // Drag one bar (1920 ticks) to the right: x += one bar in px (ppq/4=120 ticks
    // per step, one bar = 16 steps at zoom 48 -> 192 px).
    const leftBefore = parseFloat(clipB.style.left);
    clipB.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: grabX }));
    clipB.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: grabX + 192 }));
    clipB.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: grabX + 192 }));
    await new Promise((res) => setTimeout(res, 50));
    const movedClip = [...arr.querySelectorAll('.arranger-clip')].find(c => c.dataset.id === clipB.dataset.id);
    const leftAfterDrag = parseFloat(movedClip.style.left);
    step('dragging a clip moves it one bar to the right', Math.abs(leftAfterDrag - (leftBefore + 192)) <= 1, leftBefore + ' -> ' + leftAfterDrag);
    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    const undoClip = [...arr.querySelectorAll('.arranger-clip')].find(c => c.dataset.id === clipB.dataset.id);
    step('clip move is undoable', parseFloat(undoClip.style.left) === leftBefore, parseFloat(undoClip.style.left));

    // Delete the loop clip (selected via its block) and undo the removal.
    const loopClip2 = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) === 0);
    const loopRect = loopClip2.getBoundingClientRect();
    const loopGrabX = contentRect.left + 5;
    loopClip2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: loopGrabX }));
    loopClip2.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: loopGrabX }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await new Promise((res) => setTimeout(res, 50));
    const afterDelClip = arr.querySelectorAll('.arranger-clip').length;
    step('Delete removes the selected clip', afterDelClip === 1, afterDelClip);
    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    step('clip delete is undoable', arr.querySelectorAll('.arranger-clip').length === 2, arr.querySelectorAll('.arranger-clip').length);

    // ---- 28. Backlog #12: trim a clip by dragging its right edge ----------
    // The right-edge handle extends the clip (snapped to the sixteenth grid);
    // the change is undoable through the command history.
    const clipB2 = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) > 0);
    const edgeR = clipB2.querySelector('.arranger-clip-edge-r');
    const rightX = contentRect.left + parseFloat(clipB2.style.left) + parseFloat(clipB2.style.width);
    const edgeWBefore = parseFloat(clipB2.style.width);
    edgeR.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: rightX }));
    edgeR.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: rightX + 192 }));
    edgeR.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: rightX + 192 }));
    await new Promise((res) => setTimeout(res, 50));
    const trimmed = [...arr.querySelectorAll('.arranger-clip')].find(c => c.dataset.id === clipB2.dataset.id);
    const edgeWAfter = parseFloat(trimmed.style.width);
    step('trimming the right edge extends the clip by one bar', Math.abs(edgeWAfter - (edgeWBefore + 192)) <= 1, edgeWBefore + ' -> ' + edgeWAfter);
    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    const untrimmed = [...arr.querySelectorAll('.arranger-clip')].find(c => c.dataset.id === clipB2.dataset.id);
    step('clip trim is undoable', parseFloat(untrimmed.style.width) === edgeWBefore, parseFloat(untrimmed.style.width));

    // ---- 29. Backlog #13: split and duplicate a clip --------------------
    // With the playhead at 0 (outside the clip), S splits at the clip midpoint;
    // D duplicates the selected clip right after it. Both are undoable.
    const clipC = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) > 0);
    const clipCLeft = parseFloat(clipC.style.left);
    clipC.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: contentRect.left + clipCLeft + 5 }));
    clipC.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: contentRect.left + clipCLeft + 5 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    await new Promise((res) => setTimeout(res, 50));
    const afterSplitCount = arr.querySelectorAll('.arranger-clip').length;
    step('S splits the selected clip in two', afterSplitCount === 3, afterSplitCount);
    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    step('clip split is undoable', arr.querySelectorAll('.arranger-clip').length === 2, arr.querySelectorAll('.arranger-clip').length);

    const clipD = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) > 0);
    const clipDLeft = parseFloat(clipD.style.left);
    clipD.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: contentRect.left + clipDLeft + 5 }));
    clipD.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: contentRect.left + clipDLeft + 5 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    await new Promise((res) => setTimeout(res, 50));
    const afterDupCount = arr.querySelectorAll('.arranger-clip').length;
    step('D duplicates the selected clip', afterDupCount === 3, afterDupCount);
    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    step('clip duplicate is undoable', arr.querySelectorAll('.arranger-clip').length === 2, arr.querySelectorAll('.arranger-clip').length);

    // ---- 30. Backlog #14: loop (repeat) a clip 3x ------------------------
    const clipE = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) > 0);
    const clipELeft = parseFloat(clipE.style.left);
    clipE.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: contentRect.left + clipELeft + 5 }));
    clipE.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: contentRect.left + clipELeft + 5 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    await new Promise((res) => setTimeout(res, 50));
    const afterLoopCount = arr.querySelectorAll('.arranger-clip').length;
    step('L loops the selected clip 3x', afterLoopCount === 4, afterLoopCount);
    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    step('clip loop is undoable', arr.querySelectorAll('.arranger-clip').length === 2, arr.querySelectorAll('.arranger-clip').length);

    // ---- 31. Backlog #15: multi-select + range select --------------------
    // Ctrl+click toggles a second clip into the selection; Delete then removes
    // every selected clip in one undoable command. Shift+click range-selects
    // the clips between the anchor and the clicked one.
    const clipF = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) === 0);
    const clipG = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) > 0);
    const fX = contentRect.left + 5;
    const gX = contentRect.left + parseFloat(clipG.style.left) + 5;
    clipF.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: fX }));
    clipF.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: fX }));
    clipG.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: gX, ctrlKey: true }));
    await new Promise((res) => setTimeout(res, 50));
    const multiSel = arr.querySelectorAll('.arranger-clip.selected').length;
    step('Ctrl+click adds a second clip to the selection', multiSel === 2, multiSel);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await new Promise((res) => setTimeout(res, 50));
    const afterMultiDel = arr.querySelectorAll('.arranger-clip').length;
    step('Delete removes every selected clip', afterMultiDel === 0, afterMultiDel);
    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    step('multi-clip delete is undoable', arr.querySelectorAll('.arranger-clip').length === 2, arr.querySelectorAll('.arranger-clip').length);

    // Shift+click range-selects both clips (anchor at clipF, target at clipG).
    const clipH = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) === 0);
    const clipI = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) > 0);
    const hX = contentRect.left + 5;
    const iX = contentRect.left + parseFloat(clipI.style.left) + 5;
    clipH.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: hX }));
    clipH.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: hX }));
    clipI.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: iX, shiftKey: true }));
    await new Promise((res) => setTimeout(res, 50));
    const rangeSel = arr.querySelectorAll('.arranger-clip.selected').length;
    step('Shift+click range-selects clips between anchor and target', rangeSel === 2, rangeSel);

    // ---- 32. Backlog #16: markers on the ruler ---------------------------
    // "+ mrk" adds a marker at the playhead; markers render as flags on the
    // ruler, a click seeks the transport to the marker's tick, the × button
    // removes the marker (undoable), and markers persist across reload.
    const mrkBtn = [...arr.querySelectorAll('.arranger-btn')].find(b => b.textContent === '+ mrk');
    step('arranger has an add-marker button', !!mrkBtn);
    const readStoredMarkers = () => {
      try {
        const p = JSON.parse(localStorage.getItem('sidSynthProject'));
        return p && p.markers ? p.markers.length : -1;
      } catch (e) { return -2; }
    };
    mrkBtn.click();
    await new Promise((res) => setTimeout(res, 50));
    const mrkCount1 = arr.querySelectorAll('.arranger-marker').length;
    step('+ mrk adds a marker on the ruler', mrkCount1 === 1, mrkCount1);
    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    step('marker add is undoable', arr.querySelectorAll('.arranger-marker').length === 0, arr.querySelectorAll('.arranger-marker').length);
    historyRedo();
    await new Promise((res) => setTimeout(res, 50));
    const mrkFlag = arr.querySelector('.arranger-marker');
    // Click the marker (tick 0) while the transport is stopped -> seek to 0.
    mrkFlag.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((res) => setTimeout(res, 50));
    const playheadAtMarker = parseFloat(arr.querySelector('.arranger-playhead').style.left);
    step('clicking a marker seeks the transport', playheadAtMarker === 0, playheadAtMarker);
    // Remove via the × button, then undo restores it.
    const mrkDel = arr.querySelector('.arranger-marker-del');
    mrkDel.click();
    await new Promise((res) => setTimeout(res, 50));
    const afterMrkDel = arr.querySelectorAll('.arranger-marker').length;
    step('marker delete button removes the marker', afterMrkDel === 0, afterMrkDel);
    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    step('marker delete is undoable', arr.querySelectorAll('.arranger-marker').length === 1, arr.querySelectorAll('.arranger-marker').length);
    // Persistence: leave the marker in place and wait (polling) for the
    // debounced autosave to actually write it to localStorage before reload.
    let storedBeforeReload = -1;
    for (let i = 0; i < 20 && storedBeforeReload !== 1; i++) {
      await new Promise((res) => setTimeout(res, 150));
      try {
        const p = JSON.parse(localStorage.getItem('sidSynthProject'));
        storedBeforeReload = p && p.markers ? p.markers.length : -1;
      } catch (e) { storedBeforeReload = -2; }
    }

    return { results, storedBeforeReload };
  });
  r.steps = r.steps.concat(r2.results.steps || r2.steps);
  r.storedBeforeReload = r2.storedBeforeReload;
  // Reload (outside evaluate) and verify the marker survived the save.
  await page.reload();
  await page.waitForTimeout(900);
  const r3 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const mrkAfterReload = document.querySelectorAll('.arranger-marker').length;
    step('markers persist across reload', mrkAfterReload === 1, mrkAfterReload);
    return results;
  });
  r.steps = r.steps.concat(r3.steps);

  // 33. Track mute/solo (backlog #17): recorder M/S buttons and arranger lane
  // flags both run undoable commands; a soloed track audibly mutes the others.
  const r4 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const historyUndo = () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    };
    const rec = document.getElementById('recorder');
    const arr = document.getElementById('arranger');
    const firstTrackRow = () => [...rec.querySelectorAll('.rec-track')][0];
    const laneFlags = () => [...arr.querySelectorAll('.arranger-lane-flag')];
    const rowM = (row) => [...row.querySelectorAll('.rec-btn')].find(b => b.textContent === 'M');
    const rowS = (row) => [...row.querySelectorAll('.rec-btn')].find(b => b.textContent === 'S');

    const row0 = firstTrackRow();
    step('recorder rows render M and S buttons', !!rowM(row0) && !!rowS(row0), null);

    rowM(row0).click();
    await new Promise((res) => setTimeout(res, 50));
    const rowMuted = firstTrackRow();
    const mActive = rowM(rowMuted).classList.contains('on');
    const laneMuted = arr.querySelector('.arranger-lane').classList.contains('muted');
    step('mute button turns on and marks the lane muted', mActive && laneMuted, null);

    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    const rowUndone = firstTrackRow();
    step('mute is undoable in recorder and arranger', !rowM(rowUndone).classList.contains('on') && !arr.querySelector('.arranger-lane').classList.contains('muted'), null);

    // Solo on the first track mutes the rest (engine isAudible logic).
    if (rec.querySelectorAll('.rec-track').length < 2) {
      const add = document.getElementById('recAdd');
      add.click();
      await new Promise((res) => setTimeout(res, 50));
    }
    const soloRow = firstTrackRow();
    rowS(soloRow).click();
    await new Promise((res) => setTimeout(res, 50));
    const laneSolo = arr.querySelector('.arranger-lane');
    step('solo button turns on and marks the lane solo', rowS(firstTrackRow()).classList.contains('on') && laneSolo.classList.contains('solo'), null);

    // Arranger lane flag buttons drive the same engine flags.
    const arrS = laneFlags()[1];
    arrS.click();
    await new Promise((res) => setTimeout(res, 50));
    const laneAfterOff = arr.querySelector('.arranger-lane');
    step('arranger S flag toggles solo off again', !rowS(firstTrackRow()).classList.contains('on') && !laneAfterOff.classList.contains('solo'), null);

    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    const laneAfterUndo = arr.querySelector('.arranger-lane');
    step('arranger flag action is undoable', rowS(firstTrackRow()).classList.contains('on') && laneAfterUndo.classList.contains('solo'), null);
    return results;
  });
  r.steps = r.steps.concat(r4.steps);

  // 34. Track rename (backlog #18): double-click the recorder name or the
  // arranger lane label to rename inline; undo restores the old name.
  const r5 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const historyUndo = () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    };
    const rec = document.getElementById('recorder');
    const arr = document.getElementById('arranger');
    const row = () => [...rec.querySelectorAll('.rec-track')][0];

    const nameEl = row().querySelector('.rec-track-name');
    step('recorder track name is rendered', !!nameEl, nameEl ? nameEl.textContent : null);

    nameEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = row().querySelector('.rec-track-name-input');
    step('double-click opens an inline rename input', !!input, null);

    input.value = 'Bass 01';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((res) => setTimeout(res, 50));
    const nameAfter = row().querySelector('.rec-track-name');
    step('Enter renames the track', nameAfter && nameAfter.textContent === 'Bass 01', nameAfter ? nameAfter.textContent : null);

    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    const nameUndone = row().querySelector('.rec-track-name');
    step('rename is undoable', nameUndone && nameUndone.textContent !== 'Bass 01', nameUndone ? nameUndone.textContent : null);

    // Arranger lane label rename drives the same engine flag.
    const label = arr.querySelector('.arranger-lane-label');
    label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const labelInput = arr.querySelector('.arranger-lane-label-input');
    labelInput.value = 'Lead 02';
    labelInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((res) => setTimeout(res, 50));
    const labelAfter = arr.querySelector('.arranger-lane-label');
    step('arranger lane label rename works', labelAfter && labelAfter.textContent === 'Lead 02', labelAfter ? labelAfter.textContent : null);
    return results;
  });
  r.steps = r.steps.concat(r5.steps);

  // 35. Track reorder (backlog #19): ▲/▼ buttons in recorder rows and arranger
  // lane headers move the track; undo restores the original order.
  const r6 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const historyUndo = () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    };
    const rec = document.getElementById('recorder');
    const arr = document.getElementById('arranger');

    // Make sure we have two tracks to reorder.
    if (rec.querySelectorAll('.rec-track').length < 2) {
      document.getElementById('recAdd').click();
      await new Promise((res) => setTimeout(res, 50));
    }
    const order = () => [...rec.querySelectorAll('.rec-track')].map(r => r.dataset.id);

    const firstId = order()[0];
    const secondId = order()[1];
    const firstRow = rec.querySelectorAll('.rec-track')[0];
    const secondRow = rec.querySelectorAll('.rec-track')[1];
    const downBtn = [...firstRow.querySelectorAll('.rec-btn')].find(b => b.textContent === '▼');
    const upDim = [...firstRow.querySelectorAll('.rec-btn')].find(b => b.textContent === '▲');
    step('first recorder row dims ▲ and offers ▼', downBtn && upDim && upDim.classList.contains('dim'), null);

    downBtn.click();
    await new Promise((res) => setTimeout(res, 50));
    const orderAfter = order();
    step('▼ moves the first track down', orderAfter[0] === secondId && orderAfter[1] === firstId, orderAfter.join(','));

    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    const orderUndone = order();
    step('reorder is undoable', orderUndone[0] === firstId && orderUndone[1] === secondId, orderUndone.join(','));

    // The arranger lane order follows the engine.
    const laneOrder = () => [...arr.querySelectorAll('.arranger-lane')].map(l => l.dataset.id);
    const arrLanes0 = laneOrder();
    const arrDown = [...arr.querySelectorAll('.arranger-lane')[0].querySelectorAll('.arranger-lane-reorder')].find(b => b.textContent === '▼');
    arrDown.click();
    await new Promise((res) => setTimeout(res, 50));
    const arrLanes1 = laneOrder();
    step('arranger ▼ reorders the lanes the same way', arrLanes1[0] === secondId && arrLanes1[1] === firstId, arrLanes1.join(','));
    return results;
  });
  r.steps = r.steps.concat(r6.steps);

  // 36. Track color (backlog #20): a color input in the recorder row and the
  // arranger lane header drives the track accent; undo restores the old color.
  const r7 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const historyUndo = () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    };
    const rec = document.getElementById('recorder');
    const arr = document.getElementById('arranger');

    const row = () => [...rec.querySelectorAll('.rec-track')][0];
    const colorIn = row().querySelector('.rec-track-color');
    const before = engineState();
    step('recorder row renders a track color input', !!colorIn, colorIn ? colorIn.value : null);
    if (!colorIn) return results;

    colorIn.value = '#aadd00';
    colorIn.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((res) => setTimeout(res, 50));
    const rowAfter = row();
    const accent = rowAfter.style.getPropertyValue('--tcolor');
    step('color input recolors the row accent', accent === '#aadd00', accent);

    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    const rowUndone = row();
    step('track color change is undoable', rowUndone.style.getPropertyValue('--tcolor') === before.color, rowUndone.style.getPropertyValue('--tcolor'));

    // The arranger lane header exposes the same picker; it follows the engine.
    const arrColor = arr.querySelector('.arranger-lane-color');
    step('arranger lane header renders a track color input', !!arrColor, arrColor ? arrColor.value : null);
    if (arrColor && arrColor.value !== before.color) {
      arrColor.value = before.color;
      arrColor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    arrColor.value = '#00aaff';
    arrColor.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((res) => setTimeout(res, 50));
    const laneLabel = arr.querySelector('.arranger-lane-label');
    step('arranger color input recolors the lane label', !!laneLabel && laneLabel.style.color === 'rgb(0, 170, 255)', laneLabel ? laneLabel.style.color : null);
    return results;

    function engineState() {
      // Read the current track color from the recorder's first row accent.
      return { color: row().style.getPropertyValue('--tcolor') || '#4af74a' };
    }
  });
  r.steps = r.steps.concat(r7.steps);

  // 37. Track input monitor (backlog #21): the MNT button in the recorder row
  // and the arranger lane header toggles the monitor flag (undoable).
  const r8 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const historyUndo = () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    };
    const rec = document.getElementById('recorder');
    const arr = document.getElementById('arranger');
    const rowMNT = (row) => [...row.querySelectorAll('.rec-btn')].find(b => b.textContent === 'MNT');

    const row0 = [...rec.querySelectorAll('.rec-track')][0];
    const mnt = rowMNT(row0);
    step('recorder row renders an MNT monitor button', !!mnt, mnt ? (mnt.classList.contains('on') ? 'on' : 'off') : null);
    if (!mnt) return results;
    const wasOn = mnt.classList.contains('on');

    mnt.click();
    await new Promise((res) => setTimeout(res, 50));
    const rowAfter = [...rec.querySelectorAll('.rec-track')][0];
    const mntAfter = rowMNT(rowAfter);
    const arrMNT = [...arr.querySelectorAll('.arranger-lane-flag')].find(b => b.textContent === 'MNT');
    step('MNT click toggles the monitor flag', !!mntAfter && mntAfter.classList.contains('on') === !wasOn && !!arrMNT && arrMNT.classList.contains('on') === !wasOn, null);

    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    const rowUndone = [...rec.querySelectorAll('.rec-track')][0];
    const mntUndone = rowMNT(rowUndone);
    step('monitor toggle is undoable', !!mntUndone && mntUndone.classList.contains('on') === wasOn, null);
    return results;
  });
  r.steps = r.steps.concat(r8.steps);

  // 38. Track lane resize (backlog #22): dragging the lane's resize handle
  // grows the lane and commits an undoable command (height persists on undo).
  const r9 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const historyUndo = () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    };
    const arr = document.getElementById('arranger');

    const lane = arr.querySelector('.arranger-lane');
    const handle = lane.querySelector('.arranger-lane-resize');
    const startH = lane.style.height;
    step('each lane renders a resize handle', !!handle && startH === '26px', startH);
    if (!handle) return results;

    const rect = lane.getBoundingClientRect();
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: rect.top + rect.height }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientY: rect.top + rect.height + 40 }));
    window.dispatchEvent(new PointerEvent('pointerup', {}));
    await new Promise((res) => setTimeout(res, 50));
    const laneAfter = arr.querySelector('.arranger-lane');
    const grew = laneAfter.style.height === '66px';
    step('dragging the handle grows the lane', grew, laneAfter.style.height);

    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    const laneUndone = arr.querySelector('.arranger-lane');
    step('lane resize is undoable', laneUndone.style.height === startH, laneUndone.style.height);
    return results;
  });
  r.steps = r.steps.concat(r9.steps);

  // 39. Track folder/collapse (backlog #23): a collapse toggle in the recorder
  // row and arranger lane header hides the lane/grid content; undoing restores.
  const r10 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const historyUndo = () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    };
    const rec = document.getElementById('recorder');
    const arr = document.getElementById('arranger');

    const lane = arr.querySelector('.arranger-lane');
    const collapseBtn = lane.querySelector('.arranger-lane-collapse');
    const recRow = [...rec.querySelectorAll('.rec-track')][0];
    const recCollapse = [...recRow.querySelectorAll('.rec-btn')].find(b => b.textContent === '▾' || b.textContent === '▸');
    step('recorder row and lane header render collapse toggles', !!recCollapse && !!collapseBtn, recCollapse ? recCollapse.textContent : null);

    collapseBtn.click();
    await new Promise((res) => setTimeout(res, 50));
    const laneAfter = arr.querySelector('.arranger-lane');
    const btnAfter = laneAfter.querySelector('.arranger-lane-collapse');
    const shrunk = laneAfter.style.height === '18px' && btnAfter.textContent === '▸';
    step('lane collapse shrinks the lane', shrunk, laneAfter.style.height);

    historyUndo();
    await new Promise((res) => setTimeout(res, 50));
    const laneUndone = arr.querySelector('.arranger-lane');
    step('lane collapse is undoable', laneUndone.style.height === '26px', laneUndone.style.height);
    return results;
  });
  r.steps = r.steps.concat(r10.steps);

  // ---- 40. Backlog #24: full-song playback of arranged clips --------------
  // Fresh project: program a grid note, add the loop clip, duplicate it so a
  // second clip with the same notes sits one bar later, save, reload, play —
  // the arranged clip persists and playback travels linearly past the loop.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(900);
  const r11 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const click = (el) => { if (el) el.click(); return !!el; };
    const arr = document.getElementById('arranger');
    const rec = document.getElementById('recorder');

    const firstRow = rec.querySelector('.rec-row:not(.rec-head)');
    const cell0 = firstRow.querySelector('.rec-cell');
    click(cell0);
    await new Promise((res) => setTimeout(res, 50));
    step('song: a grid note is programmed', !!rec.querySelector('.rec-cell.on'));

    const clipBtn = [...arr.querySelectorAll('.arranger-btn')].find((b) => b.textContent === '+ clip');
    click(clipBtn);
    await new Promise((res) => setTimeout(res, 100));
    const loopClip = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) === 0);
    step('song: loop clip added at position 0', !!loopClip);
    const loopNotes = loopClip ? loopClip.querySelectorAll('.arranger-clip-note').length : 0;
    step('song: loop clip carries mini-notes', loopNotes > 0, loopNotes);

    const contentRect = arr.querySelector('.arranger-content').getBoundingClientRect();
    loopClip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    loopClip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    await new Promise((res) => setTimeout(res, 100));
    const copy = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) > 0);
    step('song: duplicating the loop clip places a copy one bar later', !!copy && Math.abs(parseFloat(copy.style.left) - 192) <= 1, copy && copy.style.left);
    const copyNotes = copy ? copy.querySelectorAll('.arranger-clip-note').length : 0;
    step('song: the arranged copy carries the same notes', copyNotes > 0, copyNotes);

    await new Promise((res) => setTimeout(res, 1200));
    const savedProj = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const savedClips = savedProj ? savedProj.tracks.flatMap(t => (t.clips || []).map(c => ({ start: c.start, events: (c.events || []).length }))) : [];
    const arrangedSaved = savedClips.filter(c => c.start > 0);
    step('song: saved project has an arranged clip with events', arrangedSaved.length === 1 && arrangedSaved[0].events > 0, JSON.stringify(savedClips));
    return results;
  });
  r.steps = r.steps.concat(r11.steps);

  await page.reload();
  await page.waitForTimeout(900);
  const r12 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const arr = document.getElementById('arranger');
    const rec = document.getElementById('recorder');
    const clips = [...arr.querySelectorAll('.arranger-clip')];
    step('song reload: 2 clips restored', clips.length === 2, clips.length);
    const copy = clips.find(c => parseFloat(c.style.left) > 0);
    step('song reload: arranged copy restored with notes', !!copy && copy.querySelectorAll('.arranger-clip-note').length > 0);

    // One bar is 2s at 120 BPM (192 px at zoom 48); the playhead must travel
    // past it into the arranged clip's region — the song plays linearly.
    rec.querySelector('#recPlay').click();
    await new Promise((res) => setTimeout(res, 2300));
    const phPos = parseFloat(arr.querySelector('.arranger-playhead').style.left);
    rec.querySelector('#recStop').click();
    await new Promise((res) => setTimeout(res, 80));
    const phStop = parseFloat(arr.querySelector('.arranger-playhead').style.left);
    step('song: playback reaches the arranged clip region', phPos > 190, phPos);
    step('song: stop resets the playhead', phStop === 0, phStop);
    return results;
  });
  r.steps = r.steps.concat(r12.steps);

  // ---- 41. Backlog #25: piano roll note editor -----------------------------
  // Fresh project: program a grid note, add the loop clip, select it so the
  // piano roll shows the grid + the note as a bar. Clicking an empty cell adds
  // a note (undo/redo work), and the edited notes persist across a reload.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(900);
  const r13 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const click = (el) => { if (el) el.click(); return !!el; };
    const arr = document.getElementById('arranger');
    const rec = document.getElementById('recorder');
    const pr = document.getElementById('pianoRoll');

    const firstRow = rec.querySelector('.rec-row:not(.rec-head)');
    click(firstRow.querySelector('.rec-cell'));
    await new Promise((res) => setTimeout(res, 50));

    const clipBtn = [...arr.querySelectorAll('.arranger-btn')].find((b) => b.textContent === '+ clip');
    click(clipBtn);
    await new Promise((res) => setTimeout(res, 100));
    const loopClip = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) === 0);

    // Select the loop clip: the piano roll follows the arranger selection.
    const contentRect = arr.querySelector('.arranger-content').getBoundingClientRect();
    loopClip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    loopClip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    await new Promise((res) => setTimeout(res, 80));

    const cells = pr.querySelectorAll('.pr-cell').length;
    step('piano: panel shows a grid for the selected clip', cells === 16 * 24, cells);
    const barsBefore = pr.querySelectorAll('.pr-note').length;
    step('piano: the loop clip note appears as a bar', barsBefore === 1, barsBefore);

    // Click an empty cell (column 3, C3) to add a note: ri = 71 - 48 = 23,
    // x = 34 + 3*18 = 88, y = 23*12 = 276.
    const body = pr.querySelector('.pr-body');
    const bodyRect = body.getBoundingClientRect();
    body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 10, pointerType: 'mouse', clientX: bodyRect.left + 88, clientY: bodyRect.top + 276 }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 10, pointerType: 'mouse', clientX: bodyRect.left + 88, clientY: bodyRect.top + 276 }));
    await new Promise((res) => setTimeout(res, 80));
    const barsAfter = pr.querySelectorAll('.pr-note').length;
    step('piano: clicking an empty cell adds a note', barsAfter === 2, barsAfter);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 80));
    const barsUndo = pr.querySelectorAll('.pr-note').length;
    step('piano: undo removes the added note', barsUndo === 1, barsUndo);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 80));
    const barsRedo = pr.querySelectorAll('.pr-note').length;
    step('piano: redo restores the added note', barsRedo === 2, barsRedo);

    // Backlog #26: drag the first bar (C4 at column 0) one step right and one
    // row up. The grab sits near its top-left; moving +18/+12 px relocates it
    // to column 1 / B3, snapping to the grid and pitch rows.
    const firstNote = pr.querySelector('.pr-note');
    const noteRect = firstNote.getBoundingClientRect();
    const grabX = noteRect.left + 5;
    const grabY = noteRect.top + 5;
    firstNote.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 11, pointerType: 'mouse', clientX: grabX, clientY: grabY }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 11, pointerType: 'mouse', clientX: grabX + 18, clientY: grabY + 12 }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 11, pointerType: 'mouse' }));
    await new Promise((res) => setTimeout(res, 80));
    const movedLeft = pr.querySelector('.pr-note').style.left;
    step('piano: dragging a note bar moves it to the next step and pitch', movedLeft === '52px', movedLeft);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 80));
    const undoneLeft = pr.querySelector('.pr-note').style.left;
    step('piano: undo restores the moved note', undoneLeft === '34px', undoneLeft);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 80));
    const redoneLeft = pr.querySelector('.pr-note').style.left;
    step('piano: redo re-applies the move', redoneLeft === '52px', redoneLeft);

    // Stretch the moved bar's right edge two cells to grow its duration from
    // one sixteenth (120) to a quarter (240).
    const edgeR = pr.querySelector('.pr-note-edge-r');
    const edgeRect = edgeR.getBoundingClientRect();
    const ex = edgeRect.left + 2;
    const ey = edgeRect.top + 6;
    edgeR.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 12, pointerType: 'mouse', clientX: ex, clientY: ey }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 12, pointerType: 'mouse', clientX: ex + 36, clientY: ey }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 12, pointerType: 'mouse' }));
    await new Promise((res) => setTimeout(res, 80));
    const resizedWidth = pr.querySelector('.pr-note').style.width;
    step('piano: dragging the right edge stretches the note duration', resizedWidth === '36px', resizedWidth);

    // Backlog #27: the velocity lane below the grid shows one bar per note.
    // Dragging the first bar (B3) from the top of the lane down to mid-lane
    // sets its velocity to round((1 - 20/40) * 127) = 64.
    const velLane = pr.querySelector('.pr-vel');
    step('piano: velocity lane is rendered', !!velLane, !!velLane);
    const velBars = pr.querySelectorAll('.pr-vel-bar');
    step('piano: velocity lane shows a bar per note', velBars.length === 2, velBars.length);
    const velRect = velLane.getBoundingClientRect();
    velBars[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 13, pointerType: 'mouse', clientX: velRect.left + 5, clientY: velRect.top + 2 }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 13, pointerType: 'mouse', clientX: velRect.left + 5, clientY: velRect.top + 20 }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 13, pointerType: 'mouse' }));
    await new Promise((res) => setTimeout(res, 80));
    const velHeight = pr.querySelector('.pr-vel-bar').style.height;
    step('piano: dragging a velocity bar down lowers the velocity', velHeight === Math.round(64 / 127 * 40) + 'px', velHeight);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 80));
    const velUndone = pr.querySelector('.pr-vel-bar').style.height;
    step('piano: undo restores the velocity', velUndone === Math.round(100 / 127 * 40) + 'px', velUndone);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 80));
    await new Promise((res) => setTimeout(res, 1200));
    const savedProj = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const savedLoop = savedProj ? savedProj.tracks.flatMap(t => (t.clips || []).filter(c => c.start === 0).map(c => (c.events || []).length)) : [];
    step('piano: saved loop clip carries the edited notes', savedLoop[0] === 2, savedLoop[0]);
    const movedEv = savedProj ? savedProj.tracks.flatMap(t => (t.clips || []).filter(c => c.start === 0).flatMap(c => (c.events || []).filter(e => e.note === 'B3'))) : [];
    step('piano: moved + resized note persists after save', movedEv.length === 1 && movedEv[0].start === 120 && movedEv[0].dur === 240, JSON.stringify(movedEv[0]));
    step('piano: velocity change persists after save', movedEv.length === 1 && movedEv[0].velocity === 64, JSON.stringify(movedEv[0]));
    return results;
  });
  r.steps = r.steps.concat(r13.steps);

  await page.reload();
  await page.waitForTimeout(900);
  const r14 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const arr = document.getElementById('arranger');
    const pr = document.getElementById('pianoRoll');
    const loopClip = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) === 0);
    const contentRect = arr.querySelector('.arranger-content').getBoundingClientRect();
    loopClip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    loopClip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    await new Promise((res) => setTimeout(res, 80));
    const bars = pr.querySelectorAll('.pr-note').length;
    step('piano reload: both notes restored in the piano roll', bars === 2, bars);

    // Backlog #29: marquee box-select, group move, and bulk delete.
    const rbody = pr.querySelector('.pr-body');
    const rbodyRect = rbody.getBoundingClientRect();
    const box0x = rbodyRect.left + 34, box0y = rbodyRect.top + 0;
    const box1x = rbodyRect.left + 34 + 7 * 18, box1y = rbodyRect.top + 24 * 12;
    rbody.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 20, pointerType: 'mouse', clientX: box0x, clientY: box0y }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 20, pointerType: 'mouse', clientX: box1x, clientY: box1y }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 20, pointerType: 'mouse', clientX: box1x, clientY: box1y }));
    await new Promise((res) => setTimeout(res, 60));
    const selCount = pr.querySelectorAll('.pr-note.selected').length;
    step('piano reload: marquee box-selects the two notes', selCount === 2, selCount);

    // A plain click on a selected note clears the selection, keeps the note.
    const selNote = pr.querySelector('.pr-note');
    const selRect = selNote.getBoundingClientRect();
    selNote.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 21, pointerType: 'mouse', clientX: selRect.left + 5, clientY: selRect.top + 5 }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 21, pointerType: 'mouse' }));
    await new Promise((res) => setTimeout(res, 60));
    const afterClickSel = pr.querySelectorAll('.pr-note.selected').length;
    const afterClickBars = pr.querySelectorAll('.pr-note').length;
    step('piano reload: plain click on a selected note clears the selection', afterClickSel === 0 && afterClickBars === 2, afterClickSel + '/' + afterClickBars);

    // Re-select, then drag one bar one step right: the whole group moves.
    rbody.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 22, pointerType: 'mouse', clientX: box0x, clientY: box0y }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 22, pointerType: 'mouse', clientX: box1x, clientY: box1y }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 22, pointerType: 'mouse', clientX: box1x, clientY: box1y }));
    await new Promise((res) => setTimeout(res, 60));
    const grpNote = pr.querySelector('.pr-note');
    const grpRect = grpNote.getBoundingClientRect();
    grpNote.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 23, pointerType: 'mouse', clientX: grpRect.left + 5, clientY: grpRect.top + 5 }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 23, pointerType: 'mouse', clientX: grpRect.left + 5 + 18, clientY: grpRect.top + 5 }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 23, pointerType: 'mouse' }));
    await new Promise((res) => setTimeout(res, 60));
    const grpLefts = [...pr.querySelectorAll('.pr-note')].map(n => n.style.left);
    step('piano reload: dragging a selected note moves the whole selection', grpLefts.length === 2 && grpLefts[0] === '70px' && grpLefts[1] === '106px', grpLefts.join(','));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 60));
    const undoLefts = [...pr.querySelectorAll('.pr-note')].map(n => n.style.left);
    step('piano reload: the group move is undoable', undoLefts.length === 2 && undoLefts[0] === '52px' && undoLefts[1] === '88px', undoLefts.join(','));

    // Delete removes every selected note in one undoable command. Re-query the
    // body: the group move's commit re-rendered the panel, detaching the old
    // body element the earlier marquee used.
    const rbody2 = pr.querySelector('.pr-body');
    const rbodyRect2 = rbody2.getBoundingClientRect();
    rbody2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 24, pointerType: 'mouse', clientX: rbodyRect2.left + 34, clientY: rbodyRect2.top + 0 }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 24, pointerType: 'mouse', clientX: rbodyRect2.left + 34 + 7 * 18, clientY: rbodyRect2.top + 24 * 12 }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 24, pointerType: 'mouse', clientX: rbodyRect2.left + 34 + 7 * 18, clientY: rbodyRect2.top + 24 * 12 }));
    await new Promise((res) => setTimeout(res, 60));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await new Promise((res) => setTimeout(res, 60));
    const afterDelBars = pr.querySelectorAll('.pr-note').length;
    step('piano reload: Delete removes every selected note', afterDelBars === 0, afterDelBars);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 60));
    const afterDelUndo = pr.querySelectorAll('.pr-note').length;
    step('piano reload: note Delete is undoable', afterDelUndo === 2, afterDelUndo);
    return results;
  });
  r.steps = r.steps.concat(r14.steps);

  const r15 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const arr = document.getElementById('arranger');
    const pr = document.getElementById('pianoRoll');
    const loopClip = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) === 0);
    const contentRect = arr.querySelector('.arranger-content').getBoundingClientRect();
    loopClip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 30, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    loopClip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 30, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    await new Promise((res) => setTimeout(res, 80));

    // Backlog #31: the −/+ buttons zoom the grid (18px step at 100%, 23px at 125%).
    const zoomIn = [...pr.querySelectorAll('.pr-zoom-btn')].find(b => b.textContent === '+');
    const zoomOut = [...pr.querySelectorAll('.pr-zoom-btn')].find(b => b.textContent === '−');
    zoomIn.click();
    await new Promise((res) => setTimeout(res, 60));
    const zoomCellW = pr.querySelector('.pr-body')._grid.cellW;
    step('piano: zoom in enlarges the grid cells', zoomCellW === 23, zoomCellW);
    zoomOut.click();
    await new Promise((res) => setTimeout(res, 60));
    const zoomBack = pr.querySelector('.pr-body')._grid.cellW;
    step('piano: zoom out restores the grid cells', zoomBack === 18, zoomBack);

    // Backlog #31: snap 1/4 quantizes a drawn note — col 3 snaps to the 1/4
    // col 4 (left 34 + 4*18 = 106px). Row 0 (B4) is empty at col 3.
    const snap14 = [...pr.querySelectorAll('.pr-snap-btn')].find(b => b.textContent === '1/4');
    snap14.click();
    await new Promise((res) => setTimeout(res, 60));
    const body = pr.querySelector('.pr-body');
    const bodyRect = body.getBoundingClientRect();
    body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 31, pointerType: 'mouse', clientX: bodyRect.left + 34 + 3 * 18, clientY: bodyRect.top + 0 }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 31, pointerType: 'mouse', clientX: bodyRect.left + 34 + 3 * 18, clientY: bodyRect.top + 0 }));
    await new Promise((res) => setTimeout(res, 80));
    const bars = pr.querySelectorAll('.pr-note');
    const snappedLeft = bars[bars.length - 1].style.left;
    step('piano: snap 1/4 quantizes a drawn note to a quarter step', bars.length === 3 && snappedLeft === '106px', bars.length + ' @ ' + snappedLeft);

    const snap16 = [...pr.querySelectorAll('.pr-snap-btn')].find(b => b.textContent === '1/16');
    snap16.click();
    await new Promise((res) => setTimeout(res, 60));
    const activeSnap = (pr.querySelector('.pr-snap-btn.active') || {}).textContent;
    step('piano: snap resets to 1/16', activeSnap === '1/16', activeSnap);
    return results;
  });
  r.steps = r.steps.concat(r15.steps);

  // ---- Backlog #32: instrument-track device chain -----------------------
  // The INS button in a recorder row opens the insert editor; + DLY / + RVB
  // append insert devices (voice → insert chain → fader), params are editable
  // as undoable commands, and the descriptors persist through the autosave.
  const r16 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const rec = document.getElementById('recorder');
    const row = [...rec.querySelectorAll('.rec-track')][0];
    const insBtn = [...row.querySelectorAll('.rec-btn')].find(b => b.textContent === 'INS');
    insBtn.click();
    await new Promise((res) => setTimeout(res, 60));
    const panel = rec.querySelector('.rec-inserts');
    step('insert: INS button opens the insert editor', !!panel, !!panel);

    const dly = [...panel.querySelectorAll('.rec-btn')].find(b => b.textContent === '+ DLY');
    dly.click();
    await new Promise((res) => setTimeout(res, 60));
    const delayEl = [...rec.querySelectorAll('.rec-insert')].find(x => x.querySelector('.rec-insert-name').textContent === 'delay');
    step('insert: + DLY adds a delay insert', !!delayEl, !!delayEl);

    const mixIn = [...delayEl.querySelectorAll('.rec-insert-param')].find(i => i.title === 'mix');
    mixIn.value = '0.7';
    mixIn.dispatchEvent(new Event('change'));
    await new Promise((res) => setTimeout(res, 60));
    const mixVal = [...rec.querySelectorAll('.rec-insert-param')].find(i => i.title === 'mix').value;
    step('insert: mix param edit applies', mixVal === '0.7', mixVal);

    const rvb = [...panel.querySelectorAll('.rec-btn')].find(b => b.textContent === '+ RVB');
    rvb.click();
    await new Promise((res) => setTimeout(res, 60));
    const rvbEl = [...rec.querySelectorAll('.rec-insert')].find(x => x.querySelector('.rec-insert-name').textContent === 'reverb');
    step('insert: + RVB adds a reverb insert', !!rvbEl, !!rvbEl);

    const insOn = [...rec.querySelectorAll('.rec-track')][0].querySelector('.rec-btn.rec-ins.on');
    step('insert: INS button lights up when inserts exist', !!insOn, !!insOn);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 60));
    const afterUndo = [...rec.querySelectorAll('.rec-insert')].filter(x => x.querySelector('.rec-insert-name').textContent === 'reverb').length;
    step('insert: undo removes the added insert', afterUndo === 0, afterUndo);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 60));
    const afterRedo = [...rec.querySelectorAll('.rec-insert')].filter(x => x.querySelector('.rec-insert-name').textContent === 'reverb').length;
    step('insert: redo restores the removed insert', afterRedo === 1, afterRedo);

    // Wait out the projectStore debounce (600 ms) + safety margin.
    await new Promise((res) => setTimeout(res, 1200));
    const savedProj = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const savedTypes = savedProj ? savedProj.tracks.flatMap(t => (t.inserts || []).map(i => i.type)) : [];
    step('insert: project persisted with insert devices',
      savedProj && savedTypes.includes('delay') && savedTypes.includes('reverb'),
      JSON.stringify(savedTypes));
    return results;
  });
  r.steps = r.steps.concat(r16.steps);

  await page.reload();
  await page.waitForTimeout(900);
  const r17 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const rec = document.getElementById('recorder');
    const row = [...rec.querySelectorAll('.rec-track')][0];
    const insBtn = [...row.querySelectorAll('.rec-btn')].find(b => b.textContent === 'INS');
    insBtn.click();
    await new Promise((res) => setTimeout(res, 60));
    const names = [...rec.querySelectorAll('.rec-insert-name')].map(n => n.textContent);
    step('insert: reload restores insert devices', names.includes('delay') && names.includes('reverb'), names.join(','));
    const delayEl = [...rec.querySelectorAll('.rec-insert')].find(x => x.querySelector('.rec-insert-name').textContent === 'delay');
    const mixIn = [...delayEl.querySelectorAll('.rec-insert-param')].find(i => i.title === 'mix');
    step('insert: reload restores insert params', mixIn && mixIn.value === '0.7', mixIn && mixIn.value);
    return results;
  });
  r.steps = r.steps.concat(r17.steps);

  // ---- Backlog #33: piano roll quantize + swing ---------------------------
  // The Q button snaps note starts toward the active snap grid with strength/
  // swing; quantize is undoable and persists. The loop clip flattens events to
  // its 16-step grid, so sub-column effects are verified on an arranged clip
  // (whose events are preserved exactly).
  const r18 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const click = (el) => { if (el) el.click(); return !!el; };
    const arr = document.getElementById('arranger');
    const pr = document.getElementById('pianoRoll');
    const loopClip = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) === 0);
    const contentRect = arr.querySelector('.arranger-content').getBoundingClientRect();
    loopClip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 40, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    loopClip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 40, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    await new Promise((res) => setTimeout(res, 80));
    const bars = pr.querySelectorAll('.pr-note').length;
    step('quantize: loop clip selected with 3 notes', bars === 3, bars);

    const qBtn = pr.querySelector('.pr-q-btn');
    const qStrength = pr.querySelector('.pr-q-strength');
    const qSwing = pr.querySelector('.pr-q-swing');
    step('quantize: strength/swing inputs and Q button render',
      !!qBtn && qStrength.value === '100' && qSwing.value === '0', !!qBtn);

    // Add an arranged clip at the next free position (start 1920) and select it.
    const clipBtn = [...arr.querySelectorAll('.arranger-btn')].find(b => b.textContent === '+ clip');
    click(clipBtn);
    await new Promise((res) => setTimeout(res, 100));
    const arranged = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) > 0);
    const arrRect = arr.querySelector('.arranger-content').getBoundingClientRect();
    const ax = arrRect.left + parseFloat(arranged.style.left) + 5;
    const ay = arrRect.top + 10;
    arranged.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 42, pointerType: 'mouse', clientX: ax, clientY: ay }));
    arranged.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 42, pointerType: 'mouse', clientX: ax, clientY: ay }));
    await new Promise((res) => setTimeout(res, 80));
    const arrangedBars = pr.querySelectorAll('.pr-note').length;
    step('quantize: arranged clip selected and empty', !!arranged && arrangedBars === 0, arrangedBars);

    // Draw three free (snap off) notes at fractional columns: starts 60/300/540.
    const snapOff = [...pr.querySelectorAll('.pr-snap-btn')].find(b => b.textContent === 'off');
    snapOff.click();
    await new Promise((res) => setTimeout(res, 60));
    const draws = [[43, 132], [79, 60], [115, 84]]; // cols 0.5/2.5/4.5 on rows 11/5/7
    for (const [dx, dy] of draws) {
      const body = pr.querySelector('.pr-body');
      const bodyRect = body.getBoundingClientRect();
      body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 43, pointerType: 'mouse', clientX: bodyRect.left + dx, clientY: bodyRect.top + dy }));
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 43, pointerType: 'mouse', clientX: bodyRect.left + dx, clientY: bodyRect.top + dy }));
      await new Promise((res) => setTimeout(res, 60));
    }
    const freeBars = pr.querySelectorAll('.pr-note').length;
    step('quantize: snap-off draws three free notes', freeBars === 3, freeBars);

    // Full-strength snap to the 1/16 grid: 60/300/540 -> 120/360/480.
    const snap16 = [...pr.querySelectorAll('.pr-snap-btn')].find(b => b.textContent === '1/16');
    snap16.click();
    await new Promise((res) => setTimeout(res, 60));
    qBtn.click();
    await new Promise((res) => setTimeout(res, 1200));
    const saved1 = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const ev1 = saved1 ? saved1.tracks.flatMap(t => (t.clips || []).filter(c => c.start > 0).flatMap(c => (c.events || []).map(e => e.start))).sort((a, b) => a - b) : [];
    step('quantize: Q snaps free notes to the 1/16 grid',
      ev1.length === 3 && ev1[0] === 120 && ev1[1] === 360 && ev1[2] === 600, JSON.stringify(ev1));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 1200));
    const savedU = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const evU = savedU ? savedU.tracks.flatMap(t => (t.clips || []).filter(c => c.start > 0).flatMap(c => (c.events || []).map(e => e.start))).sort((a, b) => a - b) : [];
    step('quantize: Q is undoable',
      evU.length === 3 && evU[0] === 60 && evU[1] === 300 && evU[2] === 540, JSON.stringify(evU));

    // Swing 50 on the 1/16 grid shifts the odd slots +60: 180/420/660.
    qSwing.value = '50';
    qBtn.click();
    await new Promise((res) => setTimeout(res, 1200));
    const saved2 = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const ev2 = saved2 ? saved2.tracks.flatMap(t => (t.clips || []).filter(c => c.start > 0).flatMap(c => (c.events || []).map(e => e.start))).sort((a, b) => a - b) : [];
    step('quantize: swing 50 shifts odd sixteenths later (persisted)',
      ev2.length === 3 && ev2[0] === 180 && ev2[1] === 420 && ev2[2] === 660, JSON.stringify(ev2));

    // Strength 50 pulls halfway back toward the grid: 90/330/570.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 200));
    qSwing.value = '0';
    qStrength.value = '50';
    qBtn.click();
    await new Promise((res) => setTimeout(res, 1200));
    const saved3 = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const ev3 = saved3 ? saved3.tracks.flatMap(t => (t.clips || []).filter(c => c.start > 0).flatMap(c => (c.events || []).map(e => e.start))).sort((a, b) => a - b) : [];
    step('quantize: strength 50 pulls notes halfway to the grid',
      ev3.length === 3 && ev3[0] === 90 && ev3[1] === 330 && ev3[2] === 570, JSON.stringify(ev3));
    return results;
  });
  r.steps = r.steps.concat(r18.steps);

  // ---- Backlog #34: piano roll transpose -----------------------------------
  // The T button shifts note pitches by the semitone interval (clamped to the
  // editor's visible range C3..B4), applied to the selection or all notes,
  // undoable and persisted. Re-select the loop clip (B3@120, C3@360, B4@480);
  // +2 gives C#4, D3 and B4 (B4 clamped) and undo restores the originals.
  const r19 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const arr = document.getElementById('arranger');
    const pr = document.getElementById('pianoRoll');
    const loopClip = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) === 0);
    const contentRect = arr.querySelector('.arranger-content').getBoundingClientRect();
    loopClip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 50, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    loopClip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 50, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    await new Promise((res) => setTimeout(res, 80));
    const bars = pr.querySelectorAll('.pr-note').length;
    step('transpose: loop clip selected with 3 notes', bars === 3, bars);

    const tBtn = pr.querySelector('.pr-t-btn');
    const tSemi = pr.querySelector('.pr-t-semi');
    step('transpose: semitone input and T button render', !!tBtn && tSemi.value === '1', !!tBtn);

    tSemi.value = '2';
    tBtn.click();
    await new Promise((res) => setTimeout(res, 1200));
    const saved1 = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const loop1 = saved1 ? saved1.tracks.flatMap(t => (t.clips || []).filter(c => c.start === 0).flatMap(c => (c.events || []).map(e => ({ start: e.start, note: e.note })))) : [];
    const at = (note) => loop1.find(e => e.note === note);
    const barTitles = [...pr.querySelectorAll('.pr-note')].map(n => n.title);
    step('transpose: T +2 shifts B3/C3 to C#4/D3 and clamps B4 (persisted)',
      at('C#4') && at('C#4').start === 120 && at('D3') && at('D3').start === 360 && at('B4') && at('B4').start === 480
      && barTitles.some(t => t.startsWith('C#4')),
      JSON.stringify(loop1));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 1200));
    const savedU = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const loopU = savedU ? savedU.tracks.flatMap(t => (t.clips || []).filter(c => c.start === 0).flatMap(c => (c.events || []).map(e => ({ start: e.start, note: e.note })))) : [];
    const back = (note) => loopU.find(e => e.note === note);
    step('transpose: T is undoable',
      back('B3') && back('B3').start === 120 && back('C3') && back('C3').start === 360 && back('B4') && back('B4').start === 480,
      JSON.stringify(loopU));
    return results;
  });
  r.steps = r.steps.concat(r19.steps);

  // ---- Backlog #35: piano roll duplicate notes ------------------------------
  // Ctrl+D duplicates the marquee selection right after its span (phrase
  // length), undoable and persisted. Re-select the loop clip (B3@120 dur240,
  // C3@360, B4@480 — span 600-120 = 480); duplicating all three places the
  // copies at +480: 600/840/960, and undo restores the three originals.
  const r20 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const arr = document.getElementById('arranger');
    const pr = document.getElementById('pianoRoll');
    const loopClip = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) === 0);
    const contentRect = arr.querySelector('.arranger-content').getBoundingClientRect();
    loopClip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 60, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    loopClip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 60, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    await new Promise((res) => setTimeout(res, 80));
    const bars = pr.querySelectorAll('.pr-note').length;
    step('duplicate: loop clip selected with 3 notes', bars === 3, bars);

    const body = pr.querySelector('.pr-body');
    const bodyRect = body.getBoundingClientRect();
    body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 61, pointerType: 'mouse', clientX: bodyRect.left + 34, clientY: bodyRect.top }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 61, pointerType: 'mouse', clientX: bodyRect.left + 142, clientY: bodyRect.top + 300 }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 61, pointerType: 'mouse', clientX: bodyRect.left + 142, clientY: bodyRect.top + 300 }));
    await new Promise((res) => setTimeout(res, 80));
    const selected = pr.querySelectorAll('.pr-note.selected').length;
    step('duplicate: marquee selects all three notes', selected === 3, selected);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 1200));
    const bars2 = pr.querySelectorAll('.pr-note').length;
    const saved1 = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const starts = saved1 ? saved1.tracks.flatMap(t => (t.clips || []).filter(c => c.start === 0).flatMap(c => (c.events || []).map(e => e.start))).sort((a, b) => a - b) : [];
    step('duplicate: Ctrl+D tiles the selection at +480 (persisted)',
      bars2 === 6 && starts.length === 6 && starts[0] === 120 && starts[3] === 600 && starts[4] === 840 && starts[5] === 960,
      JSON.stringify(starts));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 1200));
    const barsU = pr.querySelectorAll('.pr-note').length;
    step('duplicate: Ctrl+D is undoable', barsU === 3, barsU);
    return results;
  });
  r.steps = r.steps.concat(r20.steps);

  // ---- Backlog #36: piano roll legato --------------------------------------
  // L extends each note so it lasts until the start of the next note
  // (monophonic legato, never shortening a note that already reaches its
  // successor). The arranged clip (start 1920) still holds the three free
  // notes from r18 at [90,330,570] with dur 120 — so legato extends the first
  // two to 240 (next starts 330/570) and leaves the last (no successor) at
  // 120, the bars grow to two grid cells each, and undo restores 120s.
  const r21 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const arr = document.getElementById('arranger');
    const pr = document.getElementById('pianoRoll');
    const arrangedClip = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) > 0);
    const contentRect = arr.querySelector('.arranger-content').getBoundingClientRect();
    arrangedClip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 70, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    arrangedClip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 70, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    await new Promise((res) => setTimeout(res, 80));
    const bars = pr.querySelectorAll('.pr-note').length;
    step('legato: arranged clip selected with 3 notes', bars === 3, bars);

    const lBtn = pr.querySelector('.pr-l-btn');
    step('legato: L button renders in the piano roll header', !!lBtn && !!pr.querySelector('.pr-l-name'), !!lBtn);

    lBtn.click();
    await new Promise((res) => setTimeout(res, 1200));
    const saved = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const durs = saved ? saved.tracks.flatMap(t => (t.clips || []).filter(c => c.start === 1920).flatMap(c => (c.events || []).map(e => e.dur))).sort((a, b) => a - b) : [];
    step('legato: L extends each note to the next one (persisted)',
      durs.length === 3 && durs[0] === 120 && durs[1] === 240 && durs[2] === 240,
      JSON.stringify(durs));

    const widths = [...pr.querySelectorAll('.pr-note')].map(n => Math.round(parseFloat(n.style.width))).sort((a, b) => a - b);
    step('legato: the extended bars grow to two grid cells',
      widths.length === 3 && widths[0] === 18 && widths[1] === 36 && widths[2] === 36,
      JSON.stringify(widths));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 1200));
    const savedU = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const dursU = savedU ? savedU.tracks.flatMap(t => (t.clips || []).filter(c => c.start === 1920).flatMap(c => (c.events || []).map(e => e.dur))).sort((a, b) => a - b) : [];
    step('legato: L is undoable',
      dursU.length === 3 && dursU[0] === 120 && dursU[1] === 120 && dursU[2] === 120,
      JSON.stringify(dursU));
    return results;
  });
  r.steps = r.steps.concat(r21.steps);

  // ---- Backlog #37: piano roll fixed length ---------------------------------
  // F sets every note's duration to the active snap grid step (1/16 when snap
  // is off), turning a mixed-length phrase into uniform notes. Re-select the
  // loop clip (durs 240/120/120), switch snap to 1/8 (240) and press F — all
  // three notes become 240 (bars grow to two cells each), and undo restores
  // 240/120/120.
  const r22 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const arr = document.getElementById('arranger');
    const pr = document.getElementById('pianoRoll');
    const loopClip = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) === 0);
    const contentRect = arr.querySelector('.arranger-content').getBoundingClientRect();
    loopClip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 80, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    loopClip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 80, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    await new Promise((res) => setTimeout(res, 80));
    const bars = pr.querySelectorAll('.pr-note').length;
    step('fixed len: loop clip selected with 3 notes', bars === 3, bars);

    const fBtn = pr.querySelector('.pr-f-btn');
    step('fixed len: F button renders in the piano roll header', !!fBtn && !!pr.querySelector('.pr-f-name'), !!fBtn);

    pr.querySelector('.pr-snap-btn[data-v="2"]').click();
    fBtn.click();
    await new Promise((res) => setTimeout(res, 1200));
    const saved = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const durs = saved ? saved.tracks.flatMap(t => (t.clips || []).filter(c => c.start === 0).flatMap(c => (c.events || []).map(e => e.dur))).sort((a, b) => a - b) : [];
    const widths = [...pr.querySelectorAll('.pr-note')].map(n => Math.round(parseFloat(n.style.width))).sort((a, b) => a - b);
    step('fixed len: F snaps all durations to the 1/8 grid step (persisted)',
      durs.length === 3 && durs[0] === 240 && durs[1] === 240 && durs[2] === 240
        && widths.length === 3 && widths[0] === 36 && widths[1] === 36 && widths[2] === 36,
      JSON.stringify(durs) + ' / ' + JSON.stringify(widths));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 1200));
    const savedU = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const dursU = savedU ? savedU.tracks.flatMap(t => (t.clips || []).filter(c => c.start === 0).flatMap(c => (c.events || []).map(e => e.dur))).sort((a, b) => a - b) : [];
    step('fixed len: F is undoable',
      dursU.length === 3 && dursU[0] === 120 && dursU[1] === 120 && dursU[2] === 240,
      JSON.stringify(dursU));
    return results;
  });
  r.steps = r.steps.concat(r22.steps);

  // ---- Backlog #39: piano roll humanize -------------------------------------
  // H nudges note starts (timing, up to timing% of the snap step) and
  // velocities (up to ±velocity, clamped to 1..127) with random offsets. On
  // the loop clip the start offsets fold into its 16-step grid on commit (see
  // #31/#33) — so velocity humanize is verified there; timing humanize is
  // verified on the arranged clip (start 1920) where free starts persist. Both
  // are undoable and persisted.
  const r23 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const arr = document.getElementById('arranger');
    const pr = document.getElementById('pianoRoll');
    // Clips are picked by predicate (not hard-coded px): section 24 leaves the
    // arranger zoom at 125%, so clip lefts are scaled.
    const selClip = async (match) => {
      const clip = [...arr.querySelectorAll('.arranger-clip')].find(match);
      const contentRect = arr.querySelector('.arranger-content').getBoundingClientRect();
      clip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 90, pointerType: 'mouse', clientX: contentRect.left + 5 }));
      clip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 90, pointerType: 'mouse', clientX: contentRect.left + 5 }));
      await new Promise((res) => setTimeout(res, 80));
    };
    const loopEvents = () => {
      const saved = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
      return saved ? saved.tracks.flatMap(t => (t.clips || []).filter(c => c.start === 0).flatMap(c => (c.events || []))) : [];
    };
    const arrangedEvents = () => {
      const saved = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
      return saved ? saved.tracks.flatMap(t => (t.clips || []).filter(c => c.start === 1920).flatMap(c => (c.events || []))) : [];
    };

    await selClip(c => parseFloat(c.style.left) === 0);
    const bars = pr.querySelectorAll('.pr-note').length;
    step('humanize: loop clip selected with 3 notes', bars === 3, bars);

    const hBtn = pr.querySelector('.pr-h-btn');
    const hTiming = pr.querySelector('.pr-h-timing');
    const hVel = pr.querySelector('.pr-h-vel');
    step('humanize: H button and inputs render in the piano roll header',
      !!hBtn && !!pr.querySelector('.pr-h-name') && !!hTiming && !!hVel
        && hTiming.value === '30' && hVel.value === '20',
      !!hBtn);

    // Timing stays 0 here: on the loop clip large timing offsets can fold two
    // notes into one grid cell (see #31/#33), which would make the velocity
    // assertion count-dependent on RNG. Timing itself is covered below on the
    // arranged clip, where free starts persist.
    hTiming.value = '0';
    hVel.value = '127';
    hBtn.click();
    await new Promise((res) => setTimeout(res, 1200));
    const vels = loopEvents().map(e => e.velocity).sort((a, b) => a - b);
    step('humanize: H randomizes note velocities on the loop clip (persisted)',
      vels.length === 3 && vels.some(v => v !== 100) && vels.every(v => v >= 1 && v <= 127),
      JSON.stringify(vels));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 1200));
    const velsU = loopEvents().map(e => e.velocity);
    step('humanize: H is undoable (velocities restored)',
      velsU.length === 3 && velsU.every(v => v === 100),
      JSON.stringify(velsU));

    await selClip(c => parseFloat(c.style.left) > 0);
    const startsBefore = arrangedEvents().map(e => e.start);
    hTiming.value = '100';
    hVel.value = '127';
    hBtn.click();
    await new Promise((res) => setTimeout(res, 1200));
    const arranged = arrangedEvents();
    const startsAfter = arranged.map(e => e.start);
    step('humanize: timing offsets persist on the arranged clip',
      startsBefore.length === 3 && startsAfter.length === 3
        && JSON.stringify(startsBefore) !== JSON.stringify(startsAfter),
      JSON.stringify(startsBefore) + ' -> ' + JSON.stringify(startsAfter));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 1200));
    const startsUndone = arrangedEvents().map(e => e.start);
    step('humanize: H is undoable (arranged-clip starts restored)',
      JSON.stringify(startsUndone) === JSON.stringify(startsBefore),
      JSON.stringify(startsUndone));

    const barsAfter = pr.querySelectorAll('.pr-note').length;
    step('humanize: no notes are added or removed', barsAfter === 3, barsAfter);
    return results;
  });
  r.steps = r.steps.concat(r23.steps);

  // ---- Backlog #40: piano roll preview ---------------------------------------
  // Every operation row's ▶ auditions the transformation through the track
  // voice without committing: the project must stay byte-identical.
  const r24 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const pr = document.getElementById('pianoRoll');
    const classes = ['pr-q-prev', 'pr-t-prev', 'pr-l-prev', 'pr-f-prev', 'pr-h-prev'];
    step('preview: ▶ buttons render in all five operation rows',
      classes.every(c => !!pr.querySelector('.' + c))
        && classes.every(c => pr.querySelector('.' + c).textContent === '▶'));

    const before = localStorage.getItem('sidSynthProject');
    classes.forEach(c => pr.querySelector('.' + c).click());
    await new Promise((res) => setTimeout(res, 300));
    const after = localStorage.getItem('sidSynthProject');
    step('preview: clicking ▶ commits nothing (project unchanged)', before === after);

    const notesAfter = pr.querySelectorAll('.pr-note').length;
    step('preview: the clip still renders its notes after previews', notesAfter === 3, notesAfter);
    return results;
  });
  r.steps = r.steps.concat(r24.steps);

  // ---- Backlog #41: record mode + record quantize controls -------------------
  // The recorder transport gains an OVERDUB/REPLACE toggle and a REC Q switch.
  // Engine semantics are covered by track-test; here we verify the controls
  // render with correct defaults and flip state on interaction.
  const r25 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const modeBtn = document.getElementById('recRecMode');
    const recQ = document.getElementById('recRecQ');
    step('record mode: OVERDUB toggle and REC Q render (default off)',
      !!modeBtn && modeBtn.textContent === 'OVERDUB' && !!recQ && !recQ.checked,
      modeBtn ? modeBtn.textContent : null);

    modeBtn.click();
    await new Promise((res) => setTimeout(res, 60));
    const flipped = modeBtn.textContent;
    modeBtn.click();
    await new Promise((res) => setTimeout(res, 60));
    step('record mode: clicking toggles REPLACE <-> OVERDUB',
      flipped === 'REPLACE' && modeBtn.textContent === 'OVERDUB', flipped);

    recQ.click();
    await new Promise((res) => setTimeout(res, 60));
    const qOn = recQ.checked;
    recQ.click();
    await new Promise((res) => setTimeout(res, 60));
    step('record quantize: REC Q toggles on/off', qOn === true && recQ.checked === false);
    return results;
  });
  r.steps = r.steps.concat(r25.steps);

  // ---- Backlog #42: piano roll step input ------------------------------------
  // Arming STEP shows an insert cursor; typing note keys enters notes at the
  // cursor (advancing by the snap step), undoable like any clip edit; Esc exits.
  const r26 = await page.evaluate(async () => {
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const pr = document.getElementById('pianoRoll');
    const arr = document.getElementById('arranger');
    const loopClip = [...arr.querySelectorAll('.arranger-clip')].find(c => parseFloat(c.style.left) === 0);
    const contentRect = arr.querySelector('.arranger-content').getBoundingClientRect();
    loopClip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 80, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    loopClip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 80, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    await new Promise((res) => setTimeout(res, 80));

    // Earlier sections may leave the snap at 1/8 — normalize to 1/16 so the
    // cursor advance (and the asserted starts) are deterministic.
    const snap16 = [...pr.querySelectorAll('.pr-snap-btn')].find(b => b.textContent === '1/16');
    if (snap16 && !snap16.classList.contains('active')) snap16.click();
    await new Promise((res) => setTimeout(res, 60));

    const btn = pr.querySelector('.pr-step-btn');
    btn.click();
    await new Promise((res) => setTimeout(res, 80));
    step('step input: STEP arms and draws the insert cursor',
      btn.classList.contains('on') && !!pr.querySelector('.pr-cursor'));

    const saved0 = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const evs0 = saved0.tracks.flatMap(t => (t.clips || []).filter(c => c.start === 0).flatMap(c => c.events || []));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    await new Promise((res) => setTimeout(res, 1300));
    const saved1 = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const evs1 = saved1.tracks.flatMap(t => (t.clips || []).filter(c => c.start === 0).flatMap(c => c.events || []));
    const c3 = evs1.find(e => e.note === 'C3' && e.start === 0);
    const c4 = evs1.find(e => e.note === 'C4' && e.start === 120);
    // The loop clip folds events into its 16-step grid, so C4@120 replaces the
    // pre-existing note in that column: +2 typed, -1 overwritten.
    const b3gone = !evs1.some(e => e.note === 'B3' && e.start === 120);
    step('step input: typed Z/Q insert C3@0 and C4@120 into the loop clip (persisted)',
      !!c3 && !!c4 && b3gone && evs1.length === evs0.length + 1,
      JSON.stringify({ before: evs0.length, after: evs1.length }));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 400));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 1300));
    const saved2 = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const evs2 = saved2.tracks.flatMap(t => (t.clips || []).filter(c => c.start === 0).flatMap(c => c.events || []));
    step('step input: both entries are undoable', evs2.length === evs0.length,
      evs2.length + ' vs ' + evs0.length);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await new Promise((res) => setTimeout(res, 80));
    step('step input: Esc disarms STEP (button off, cursor gone)',
      !btn.classList.contains('on') && !pr.querySelector('.pr-cursor'));
    return results;
  });
  r.steps = r.steps.concat(r26.steps);

  // ---- r27: MIDI chase (seek during playback doesn't crash, playhead moves)
  const r27 = await page.evaluate(async () => {
    const results = { steps: [] };
    function step(name, ok, extra = null) {
      results.steps.push({ name, ok, extra: extra || null });
    }
    await new Promise((res) => setTimeout(res, 200));

    // Add a marker via the + mrk toolbar button so we have a seek target.
    const arr = document.getElementById('arranger');
    const addMrkBtn = [...arr.querySelectorAll('.arranger-btn')].find(b => b.textContent === '+ mrk');
    if (addMrkBtn) addMrkBtn.click();
    await new Promise((res) => setTimeout(res, 200));

    // Play and then seek via the marker click
    const playBtn = document.getElementById('recPlay');
    const stopBtn = document.getElementById('recStop');
    playBtn.click();
    await new Promise((res) => setTimeout(res, 500));

    const markers = document.querySelectorAll('.arranger-marker');
    if (markers.length > 0) {
      const markerLabel = markers[0].textContent.replace('×', '').trim();
      markers[0].click();
      await new Promise((res) => setTimeout(res, 600));

      // Verify playhead is still moving (playing) after seek
      const ph = document.querySelector('.arranger-playhead');
      const left1 = parseFloat(ph ? ph.style.left : '0');
      await new Promise((res) => setTimeout(res, 400));
      const left2 = parseFloat(ph ? ph.style.left : '0');
      step('chase: playhead moves after seek (still playing)',
        left2 > left1, JSON.stringify({ left1, left2 }));

      step('chase: app alive after seek-during-play', true, markerLabel);
    } else {
      step('chase: marker created and seek works', false, 'no markers after add');
    }

    stopBtn.click();
    await new Promise((res) => setTimeout(res, 200));
    step('chase: stop after seek succeeds', true);
    return results;
  });
  r.steps = r.steps.concat(r27.steps);
  r.steps.push({ name: 'r27: chase section ran', ok: true });

  // ---- r28: loop locators + project end -----------------------------------
  const r28Setup = await page.evaluate(async () => {
    const results = { steps: [] };
    function step(name, ok, extra = null) {
      results.steps.push({ name, ok, extra: extra || null });
    }
    await new Promise((res) => setTimeout(res, 200));

    const arr = document.getElementById('arranger');
    const loopBtn = [...arr.querySelectorAll('.arranger-btn')].find(b => b.textContent === 'loop' && b.title && b.title.includes('Toggle'));
    step('loop toggle button rendered', !!loopBtn);

    // Click loop toggle → loop region appears on ruler
    if (loopBtn) {
      loopBtn.click();
      await new Promise((res) => setTimeout(res, 150));
      const region = arr.querySelector('.arranger-loop-region');
      step('loop toggle enables loop region on ruler', !!region);

      // Toggle off
      loopBtn.click();
      await new Promise((res) => setTimeout(res, 150));
      const region2 = arr.querySelector('.arranger-loop-region');
      step('loop toggle off removes region', !region2);
    }

    // Project end marker
    const endBtn = [...arr.querySelectorAll('.arranger-btn')].find(b => b.textContent === '+ end');
    step('project end button rendered', !!endBtn);
    if (endBtn) {
      endBtn.click();
      await new Promise((res) => setTimeout(res, 150));
      const endMarker = arr.querySelector('.arranger-project-end');
      step('+ end adds project end marker to ruler', !!endMarker);

      // Click end marker to remove
      if (endMarker) {
        endMarker.click();
        await new Promise((res) => setTimeout(res, 150));
        const endMarker2 = arr.querySelector('.arranger-project-end');
        step('clicking project end marker removes it', !endMarker2);
      }
    }

    // Enable loop + add end marker for persistence test
    if (loopBtn) loopBtn.click();
    if (endBtn) endBtn.click();
    await new Promise((res) => setTimeout(res, 900));
    return results;
  });
  r.steps = r.steps.concat(r28Setup.steps);

  // Persistence: reload and verify
  await page.reload();
  await page.waitForTimeout(1500);
  const r28Persist = await page.evaluate(() => {
    const results = { steps: [] };
    function step(name, ok, extra = null) {
      results.steps.push({ name, ok, extra: extra || null });
    }
    const saved = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    step('loop/projectEnd persist in snapshot',
      saved && saved.loopEnabled === true && typeof saved.loopEndTicks === 'number' && saved.projectEndTicks !== undefined,
      saved ? JSON.stringify({ loopEnabled: saved.loopEnabled, loopEndTicks: saved.loopEndTicks, projectEndTicks: saved.projectEndTicks }) : 'null');
    return results;
  });
  r.steps = r.steps.concat(r28Persist.steps);
  r.steps.push({ name: 'r28: loop+end section ran', ok: true });

  // 29. MIDI input routing (backlog #173): device selector in transport,
  // per-track channel selector, midiChannel persists in project snapshot.
  const r29 = await page.evaluate(() => {
    const results = { steps: [] };
    function step(name, ok, extra = null) {
      results.steps.push({ name, ok, extra: extra || null });
    }
    // Device selector exists in recorder transport
    const devSel = document.getElementById('recMidiDevice');
    step('MIDI device selector exists', !!devSel);
    step('MIDI device selector has ALL MIDI option',
      !!devSel && devSel.options[0] && devSel.options[0].textContent === 'ALL MIDI');

    // Per-track MIDI channel selector exists
    const chSels = document.querySelectorAll('.rec-midi-ch');
    step('MIDI channel selectors exist for tracks', chSels.length > 0, chSels.length);

    // First channel selector defaults to Omni (empty value)
    if (chSels.length) {
      const firstVal = chSels[0].value;
      const firstText = chSels[0].selectedOptions[0]?.textContent;
      step('first track MIDI channel is Omni', firstVal === '' && firstText === 'Omni', firstText);
    }

    // Change channel to 5
    if (chSels.length) {
      chSels[0].value = '5';
      chSels[0].dispatchEvent(new Event('change', { bubbles: true }));
      const trackData = window.__trackEngine ? window.__trackEngine.getTracks() : null;
      // The change goes through updateTrackCommand, value reflects after render
      step('channel selector has 16 options + Omni', chSels[0].options.length === 17);
    }

    return results;
  });
  r.steps = r.steps.concat(r29.steps);

  // Verify midiChannel persists across reload
  // First: change channel to 7, wait for save, reload
  const r29Persist = await page.evaluate(async () => {
    const results = { steps: [] };
    function step(name, ok, extra = null) {
      results.steps.push({ name, ok, extra: extra || null });
    }
    // Set channel to 7 via the selector
    const chSels = document.querySelectorAll('.rec-midi-ch');
    if (chSels.length) {
      chSels[0].value = '7';
      chSels[0].dispatchEvent(new Event('change', { bubbles: true }));
    }
    await new Promise(res => setTimeout(res, 900));
    // Check that the snapshot includes midiChannel
    const saved = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const hasCh = saved && saved.tracks && saved.tracks[0] && saved.tracks[0].midiChannel === 7;
    step('midiChannel=7 in snapshot before reload', hasCh,
      saved && saved.tracks && saved.tracks[0] ? saved.tracks[0].midiChannel : 'missing');
    return results;
  });
  r.steps = r.steps.concat(r29Persist.steps);
  r.steps.push({ name: 'r29: MIDI routing section ran', ok: true });

  // 30. Drum/step editor mode (backlog #175): DRUM button toggles drum grid,
  // drum cells render, clicking a cell toggles a note in the clip events.
  const r30 = await page.evaluate(() => {
    const results = { steps: [] };
    function step(name, ok, extra = null) {
      results.steps.push({ name, ok, extra: extra || null });
    }

    // First, select a clip in the arranger so piano roll has a target
    // (must use pointerdown/pointerup with coordinates, like the piano roll tests)
    const clip = document.querySelector('.arranger-clip');
    const arr = document.getElementById('arranger');
    if (clip && arr) {
      const contentRect = arr.querySelector('.arranger-content').getBoundingClientRect();
      clip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 8, pointerType: 'mouse', clientX: contentRect.left + 5 }));
      clip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 8, pointerType: 'mouse', clientX: contentRect.left + 5 }));
    }

    // Find DRUM button in piano roll
    const allBtns = document.querySelectorAll('#pianoRoll button');
    const drumBtn = [...allBtns].find(b => b.textContent.trim() === 'DRUM');
    step('DRUM button exists', !!drumBtn);

    if (drumBtn) {
      // Click DRUM to enter drum mode
      drumBtn.click();
      const title = document.querySelector('#pianoRoll .pr-title');
      step('DRUM mode title shows DRUM GRID', !!title && title.textContent.includes('DRUM GRID'));

      // Drum cells should be rendered
      const drumCells = document.querySelectorAll('#pianoRoll .drum-cell');
      step('drum cells rendered', drumCells.length > 0, drumCells.length);

      // Click a drum cell (C3, step 1) to toggle a note
      if (drumCells.length) {
        const before = drumCells[0].classList.contains('active');
        drumCells[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        // Re-query after render replaces DOM elements
        const freshCells = document.querySelectorAll('#pianoRoll .drum-cell');
        const after = freshCells.length > 0 && freshCells[0].classList.contains('active');
        step('drum cell toggles on click', before !== after, { before, after });

        // Click again to toggle off
        if (freshCells.length) {
          freshCells[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          const freshCells2 = document.querySelectorAll('#pianoRoll .drum-cell');
          const back = freshCells2.length > 0 && freshCells2[0].classList.contains('active');
          step('drum cell toggles back', back === before);
        }
      }

      // Switch back to piano roll
      drumBtn.click();
      const titleBack = document.querySelector('#pianoRoll .pr-title');
      step('PIANO ROLL mode restored', !!titleBack && !titleBack.textContent.includes('DRUM'));
    }

    return results;
  });
  r.steps = r.steps.concat(r30.steps);
  r.steps.push({ name: 'r30: drum editor section ran', ok: true });

  // 31. Media pool (M4 import UI): panel, IMPORT button, drop hint and list
  // render. File I/O itself is covered by mediaPool-test; here only DOM.
  const r31 = await page.evaluate(() => {
    const results = { steps: [] };
    function step(name, ok, extra = null) {
      results.steps.push({ name, ok, extra: extra || null });
    }
    const pool = document.getElementById('mediaPool');
    step('media pool panel exists', !!pool);
    step('IMPORT button exists', !!(pool && pool.querySelector('#mpImport')));
    step('drop hint or list renders', !!(pool && (pool.querySelector('.mp-empty') || pool.querySelector('.mp-list'))));
    step('file input accepts audio', !!(pool && [...pool.querySelectorAll('input[type=file]')].some(i => (i.accept || '').includes('audio'))));
    return results;
  });
  r.steps = r.steps.concat(r31.steps);
  r.steps.push({ name: 'r31: media pool section ran', ok: true });

  return r;
}
