const STORAGE_KEY = 'sidSynthPresets';

export function createPatchStore({ components, captureParams, applyParams, createComponent, clearRack, drawConnections, connections, addConnection }) {
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
    const ids = Object.keys(components);
    const indexOf = {};
    ids.forEach((id, i) => indexOf[id] = i);
    const presets = getAllPresets();
    presets[name] = {
      components: ids.map(id => ({
        type: components[id].type,
        x: parseInt(components[id].element.style.left) || 0,
        y: parseInt(components[id].element.style.top) || 0,
        params: captureParams(components[id])
      })),
      connections: (connections || []).map(c => ({
        from: indexOf[c.from],
        to: c.to === 'master' ? 'master' : indexOf[c.to],
        toChannel: c.toChannel ?? null,
        outChannel: c.outChannel ?? 0
      })).filter(c => c.from !== undefined && (c.to === 'master' || c.to !== undefined))
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
    const idMap = {};
    preset.components.forEach((comp, i) => {
      createComponent(comp.type, '', 0, 0);
      const ids = Object.keys(components);
      const id = ids[ids.length - 1];
      idMap[i] = id;
      const c = components[id];
      if (c) {
        c.element.style.left = (comp.x || 0) + 'px';
        c.element.style.top = (comp.y || 0) + 'px';
        applyParams(c, comp.params);
      }
    });
    (preset.connections || []).forEach(conn => {
      const from = idMap[conn.from];
      const to = conn.to === 'master' ? 'master' : idMap[conn.to];
      if (from && to) addConnection(from, to, conn.toChannel ?? null, conn.outChannel ?? 0);
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
