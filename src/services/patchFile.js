export function createPatchFile({ components, connections, captureParams, createComponent, applyParams, clearRack, drawConnections, addConnection }) {
  function savePatch() {
    const patch = {
      components: Object.keys(components).map(id => ({
        id,
        type: components[id].type,
        x: parseInt(components[id].element.style.left) || 0,
        y: parseInt(components[id].element.style.top) || 0,
        params: captureParams(components[id])
      })),
      connections
    };
    const blob = new Blob([JSON.stringify(patch, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sid-synth-patch.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function loadPatch(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const patch = JSON.parse(e.target.result);
        if (!patch.components || !Array.isArray(patch.components)) throw new Error('Invalid patch format');
        clearRack();
        const idMap = {};
        patch.components.forEach(c => {
          const createId = (c.type === 'oscillator' && c.params && c.params.n) ? 'osc' + c.params.n : c.id;
          const before = new Set(Object.keys(components));
          createComponent(c.type, createId, c.x, c.y);
          const createdId = Object.keys(components).find(id => !before.has(id));
          idMap[c.id] = createdId;
          if (createdId && components[createdId]) applyParams(components[createdId], c.params);
        });
        (patch.connections || []).forEach(conn => {
          const channel = conn.toChannel !== undefined && conn.toChannel !== null ? conn.toChannel : null;
          const from = idMap[conn.from] ?? conn.from;
          const to = conn.to === 'master' ? 'master' : (idMap[conn.to] ?? conn.to);
          addConnection(from, to, channel);
        });
        drawConnections();
        console.log('Patch loaded:', patch.components.map(c => c.type).join(', '));
      } catch (err) {
        console.error('Failed to load patch:', err);
        alert('Failed to load patch: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  return { savePatch, loadPatch };
}
