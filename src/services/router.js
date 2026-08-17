export function createRouter({ components, masterGain, rack, svgEl, masterPortEl }) {
  const connections = [];
  let currentConnectionFrom = null;
  let tempLine = null;
  let selectedConnection = null;

  function drawConnections() {
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

    const rackRect = rack.getBoundingClientRect();
    const masterRect = masterPortEl ? masterPortEl.getBoundingClientRect() : null;

    connections.forEach((conn, index) => {
      const fromComp = components[conn.from];
      if (!fromComp || !fromComp.element) return;

      let outSel = '[data-type="output"]';
      if (fromComp.type === 'splitter' && conn.outChannel !== undefined && conn.outChannel !== null) {
        outSel = `[data-type="output"][data-channel="${conn.outChannel}"]`;
      }
      const fromOutput = fromComp.element.querySelector(outSel);
      if (!fromOutput) return;
      const r1 = fromOutput.getBoundingClientRect();
      const x1 = r1.left - rackRect.left + r1.width / 2;
      const y1 = r1.top - rackRect.top + r1.height / 2;

      let x2, y2, toLabel;

      if (conn.to === 'master') {
        if (!masterRect) return;
        x2 = masterRect.left - rackRect.left + masterRect.width / 2;
        y2 = masterRect.top - rackRect.top + masterRect.height / 2;
        toLabel = 'MASTER';
      } else {
        const toComp = components[conn.to];
        if (!toComp || !toComp.element) return;

        let toInput;
        if (toComp.type === 'mixer' && conn.toChannel !== null) {
          toInput = toComp.element.querySelector(`[data-type="input"][data-channel="${conn.toChannel}"]`);
          toLabel = `${conn.to} CH${conn.toChannel + 1}`;
        } else {
          toInput = toComp.element.querySelector('[data-type="input"]');
          toLabel = conn.to;
        }

        if (!toInput) return;
        const r2 = toInput.getBoundingClientRect();
        x2 = r2.left - rackRect.left + r2.width / 2;
        y2 = r2.top - rackRect.top + r2.height / 2;
      }

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const cx = (x1 + x2) / 2;
      const d = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', selectedConnection === index ? '#ffaa00' : (conn.mod ? '#ff55ff' : '#4af74a'));
      path.setAttribute('stroke-width', selectedConnection === index ? '3' : '2');
      path.setAttribute('opacity', selectedConnection === index ? '1' : '0.7');
      path.style.cursor = 'pointer';
      path.dataset.index = index;

      path.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectedConnection === index) {
          deleteConnection(index);
          selectedConnection = null;
        } else {
          selectedConnection = index;
          drawConnections();
        }
      });

      path.addEventListener('mouseenter', () => {
        if (selectedConnection !== index) {
          path.setAttribute('opacity', '1');
          path.setAttribute('stroke-width', '3');
        }
      });

      path.addEventListener('mouseleave', () => {
        if (selectedConnection !== index) {
          path.setAttribute('opacity', '0.7');
          path.setAttribute('stroke-width', '2');
        }
      });

      svgEl.appendChild(path);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', (x1 + x2) / 2);
      label.setAttribute('y', (y1 + y2) / 2 - 5);
      label.setAttribute('fill', '#4af74a');
      label.setAttribute('font-size', '8px');
      label.textContent = `${conn.from} → ${toLabel}`;
      svgEl.appendChild(label);
    });
  }

  function deleteConnection(index) {
    if (isNaN(index) || index < 0 || index >= connections.length) return;
    const conn = connections[index];

    const fromComp = components[conn.from];
    if (conn.mod && fromComp && fromComp.outputGain) {
      const toComp = components[conn.to];
      if (toComp && typeof toComp.getModParam === 'function') {
        const p = toComp.getModParam();
        if (p) { try { fromComp.outputGain.disconnect(p); } catch(e) {} }
      }
      connections.splice(index, 1);
      drawConnections();
      return;
    }

    if (fromComp && fromComp.outputGain) {
      if (conn.to === 'master') {
        try { fromComp.outputGain.disconnect(masterGain); } catch(e) {}
      } else {
        const toComp = components[conn.to];
        if (toComp) {
          if (toComp.type === 'mixer' && conn.toChannel !== null && toComp.inputGains) {
            try { fromComp.outputGain.disconnect(toComp.inputGains[conn.toChannel]); } catch(e) {}
          } else if (toComp.inputGain) {
            try { fromComp.outputGain.disconnect(toComp.inputGain); } catch(e) {}
          }
        }
      }
    }

    connections.splice(index, 1);
    drawConnections();
  }

  function addConnection(fromId, toId, toChannel = null, outChannel = 0) {
    if (fromId === toId) return;
    const fromComp = components[fromId];
    const toComp = components[toId];
    const isMod = fromComp && fromComp.type === 'lfo' && toComp && typeof toComp.getModParam === 'function' && !!toComp.getModParam();
    if (connections.some(c => c.from === fromId && c.to === toId && c.toChannel === toChannel && c.outChannel === outChannel && !!c.mod === !!isMod)) return;

    let channel = toChannel;

    const fromOutput = fromComp ? fromComp.outputGain : null;
    const toInput = toComp ? (toComp.inputGain || (toComp.inputGains && toComp.inputGains[channel])) : null;

    if (fromOutput) {
      if (toId === 'master') {
        fromOutput.connect(masterGain, outChannel, 0);
        connections.push({ from: fromId, to: toId, toChannel: null, outChannel });
      } else if (isMod) {
        const modParam = toComp.getModParam();
        fromOutput.connect(modParam);
        connections.push({ from: fromId, to: toId, toChannel: null, outChannel, mod: true });
      } else if (toComp && toComp.type === 'mixer' && toComp.inputGains) {
        if (channel === null) {
          let usedChannels = connections.filter(c => c.to === toId && c.toChannel !== null).map(c => c.toChannel);
          channel = [0, 1, 2, 3].find(i => !usedChannels.includes(i));
        }
        if (channel !== undefined) {
          connections.push({ from: fromId, to: toId, toChannel: channel, outChannel });
          fromOutput.connect(toComp.inputGains[channel], outChannel, 0);
        }
      } else if (toInput) {
        fromOutput.connect(toInput, outChannel, 0);
        connections.push({ from: fromId, to: toId, toChannel: null, outChannel });
      }
    }

    drawConnections();
  }

  function initPortClicks() {
    if (masterPortEl) {
      masterPortEl.style.cursor = 'crosshair';
      masterPortEl.title = 'Click to connect component output here';
      masterPortEl.onclick = () => {
        if (currentConnectionFrom) {
          addConnection(currentConnectionFrom.id, 'master', null, currentConnectionFrom.outChannel);
          currentConnectionFrom.port.style.background = '';
          currentConnectionFrom = null;
        }
      };
    }

    Object.keys(components).forEach(id => {
      const comp = components[id];
      if (!comp || !comp.element) return;

      const outputPorts = comp.element.querySelectorAll('[data-type="output"]');
      outputPorts.forEach(outputPort => {
        outputPort.style.cursor = 'crosshair';
        outputPort.title = 'Click to connect output';
        outputPort.onclick = (e) => {
          e.stopPropagation();
          if (currentConnectionFrom) {
            if (currentConnectionFrom.id === id) {
              currentConnectionFrom = null;
              if (tempLine) { tempLine.remove(); tempLine = null; }
              return;
            }
            addConnection(currentConnectionFrom.id, id, null, currentConnectionFrom.outChannel);
            currentConnectionFrom.port.style.background = '';
            currentConnectionFrom = null;
            if (tempLine) { tempLine.remove(); tempLine = null; }
          } else {
            currentConnectionFrom = {
              id,
              port: outputPort,
              outChannel: outputPort.dataset.channel !== undefined ? parseInt(outputPort.dataset.channel) : 0
            };
            outputPort.style.background = '#4af74a';
          }
        };
      });

      const inputPorts = comp.element.querySelectorAll('[data-type="input"]');
      inputPorts.forEach(inputPort => {
        inputPort.style.cursor = 'crosshair';
        inputPort.title = 'Click to receive connection';
        inputPort.onclick = (e) => {
          e.stopPropagation();

          const existingConnIndex = connections.findIndex(c => {
            if (comp.type === 'mixer') {
              return c.to === id && c.toChannel !== null &&
                inputPort.dataset.channel == c.toChannel;
            }
            return c.to === id;
          });

          if (existingConnIndex !== -1) {
            deleteConnection(existingConnIndex);
            return;
          }

          if (currentConnectionFrom) {
            let toChannel = null;
            if (comp.type === 'mixer' && inputPort.dataset.channel !== undefined) {
              toChannel = parseInt(inputPort.dataset.channel);
            }
            addConnection(currentConnectionFrom.id, id, toChannel, currentConnectionFrom.outChannel);
            currentConnectionFrom.port.style.background = '';
            currentConnectionFrom = null;
            if (tempLine) { tempLine.remove(); tempLine = null; }
          }
        };
      });
    });
  }

  function init() {
    document.addEventListener('mousemove', e => {
      if (!currentConnectionFrom) return;
      if (tempLine) tempLine.remove();

      const rackRect = rack.getBoundingClientRect();
      const fromComp = components[currentConnectionFrom.id];
      if (!fromComp) return;
      const fromOutput = fromComp.element.querySelector('[data-type="output"]');
      if (!fromOutput) return;

      const r1 = fromOutput.getBoundingClientRect();
      const x1 = r1.left - rackRect.left + r1.width / 2;
      const y1 = r1.top - rackRect.top + r1.height / 2;
      const x2 = e.clientX - rackRect.left;
      const y2 = e.clientY - rackRect.top;

      const cx = (x1 + x2) / 2;
      tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      tempLine.setAttribute('d', `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`);
      tempLine.setAttribute('fill', 'none');
      tempLine.setAttribute('stroke', '#4af74a');
      tempLine.setAttribute('stroke-width', '2');
      tempLine.setAttribute('opacity', '0.4');
      tempLine.setAttribute('stroke-dasharray', '5,5');
      svgEl.appendChild(tempLine);
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (currentConnectionFrom) {
          currentConnectionFrom.port.style.background = '';
          currentConnectionFrom = null;
          if (tempLine) { tempLine.remove(); tempLine = null; }
        }
        selectedConnection = null;
        drawConnections();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedConnection !== null) {
          deleteConnection(selectedConnection);
          selectedConnection = null;
        }
      }
    });

    rack.addEventListener('click', e => {
      if (e.target !== rack) return;
      if (currentConnectionFrom) {
        currentConnectionFrom.port.style.background = '';
        currentConnectionFrom = null;
        if (tempLine) { tempLine.remove(); tempLine = null; }
      }
      if (selectedConnection !== null) {
        selectedConnection = null;
        drawConnections();
      }
    });

    initPortClicks();
  }

  function clear() {
    connections.length = 0;
    selectedConnection = null;
    currentConnectionFrom = null;
    if (tempLine) { tempLine.remove(); tempLine = null; }
    drawConnections();
  }

  function removeConnectionsOf(id) {
    const next = connections.filter(c => c.from !== id && c.to !== id);
    connections.length = 0;
    connections.push(...next);
    drawConnections();
  }

  return {
    connections,
    drawConnections,
    deleteConnection,
    addConnection,
    initPortClicks,
    init,
    clear,
    removeConnectionsOf,
  };
}
