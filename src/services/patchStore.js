const STORAGE_KEY = 'sidSynthPresets';

export function createPatchStore({ components, captureParams, applyParams, createComponent, clearRack, drawConnections }) {
  function getAllPresets() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch (e) { return {}; }
  }

  function refreshPresetList() {
    const list = document.getElementById('presetList');
    if (!list) return;
    list.innerHTML = '';
    Object.keys(getAllPresets()).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      list.appendChild(opt);
    });
  }

  function savePreset() {
    const name = prompt('Preset name:', 'my-preset');
    if (!name) return;
    const presets = getAllPresets();
    presets[name] = {
      components: Object.keys(components).map(id => ({
        type: components[id].type,
        params: captureParams(components[id])
      }))
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    refreshPresetList();
  }

  function loadPreset() {
    const name = document.getElementById('presetList').value;
    const presets = getAllPresets();
    const preset = presets[name];
    if (!preset || !preset.components) return;
    clearRack();
    preset.components.forEach(({ type, params }) => {
      createComponent(type, '', 40, 40);
      const ids = Object.keys(components);
      const id = ids[ids.length - 1];
      if (components[id]) applyParams(components[id], params);
    });
    drawConnections();
  }

  function deletePreset() {
    const name = document.getElementById('presetList').value;
    if (!name) return;
    const presets = getAllPresets();
    delete presets[name];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    refreshPresetList();
  }

  return { getAllPresets, refreshPresetList, savePreset, loadPreset, deletePreset };
}
