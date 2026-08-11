// E2E integration test for SID Synth.
// Runs against the live app (http://127.0.0.1:3000) via a browser-automation
// harness (Playwright MCP): `async (page) => {...}`. Exercises the real
// main.js: drag&drop rack, patch routing, modulation cables, keyboard,
// patch save/load round-trip, cable deletion, presets (built-in + localStorage).
async (page) => {
  const r = await page.evaluate(async () => {
    localStorage.clear();
    window.prompt = () => 'it-preset';
    window.alert = () => {};
    const results = { steps: [] };
    const step = (name, ok, extra) => results.steps.push({ name, ok, extra: extra || null });
    const rack = document.getElementById('rack');
    const drop = (type, id, x, y) => {
      const dt = new DataTransfer();
      dt.setData('type', type);
      dt.setData('id', id || '');
      rack.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientX: x, clientY: y }));
    };
    const byType = (t) => [...document.querySelectorAll('.rack .component')].find((c) => c.dataset.type === t);
    const click = (el) => { if (el) el.click(); return !!el; };
    const clickPort = (el) => { if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!el; };
    const cableCount = () => document.querySelectorAll('#connectionsSvg path').length;

    // 1. Create a full rack
    drop('oscillator', 'osc1', 160, 120);
    drop('filter', '', 400, 120);
    drop('adsr', '', 640, 120);
    drop('lfo', '', 160, 300);
    drop('mixer', '', 880, 120);
    drop('splitter', '', 160, 460);
    drop('sequencer', '', 400, 460);
    step('create 7 components', document.querySelectorAll('.rack .component').length === 7);

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

    return results;
  });
  return r;
}
