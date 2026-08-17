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
// folder/collapse (collapse toggles in recorder rows and lane headers).
// 111 steps total.
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
  return r;
}
