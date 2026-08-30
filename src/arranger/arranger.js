// Minimal linear arranger: a scrollable timeline with a bar ruler, one lane per
// track (16-step pattern rendered as blocks that repeat each bar), a playhead
// that follows the unified transport, and zoom/scroll controls. Pure DOM — it
// reads tracks from the engine and musical time from the transport's tempo map.

import { computeRuler, contentWidthTicks, layoutTrackBlocks, layoutClips, layoutClipNotes, ticksToX, xToTicks, snapTicks } from './arrangerLayout.js';
import { addClipCommand, moveClipCommand, splitClipCommand, duplicateClipCommand, repeatClipCommand, moveClipsCommand, removeClipsCommand, setTrackFlagCommand, renameTrackCommand, reorderTrackCommand, updateTrackCommand, resizeTrackCommand } from '../project/trackCommands.js';
import { addMarkerCommand, removeMarkerCommand } from '../project/markerCommands.js';

const DEFAULT_ZOOM = 48;      // px per quarter note
const MIN_ZOOM = 12;
const MAX_ZOOM = 192;
const LANE_HEIGHT = 26;
const COLLAPSED_HEIGHT = 18;  // a collapsed lane keeps just its header (backlog #23)
const RULER_HEIGHT = 20;
const BARS = 8;

export function createArranger({ container, engine, transport, history, markers, cfg = {} }) {
  const el = container;
  const pxPerQuarter = cfg.pxPerQuarter || DEFAULT_ZOOM;
  const bars = cfg.bars || BARS;
  const laneHeight = cfg.laneHeight || LANE_HEIGHT;
  const rulerHeight = cfg.rulerHeight || RULER_HEIGHT;
  let zoom = pxPerQuarter;
  let playheadTicks = 0;
  let selection = [];  // [{ trackId, clipId }] of selected clips (multi-select)
  let anchor = null;   // { trackId, clipId } last-clicked clip (range anchor)
  let drag = null;     // live drag state: { trackId, clipId, startTicks, dxTicks, clips }
  let resize = null;   // live trim state: { trackId, clipId, edge, grabTicks, startTicks, endTicks }

  // ---- selection helpers ----------------------------------------------
  function isSelected(trackId, clipId) {
    return selection.some(s => s.trackId === trackId && s.clipId === clipId);
  }
  // The primary clip for single-clip operations (S/D/L) is the anchor.
  function primarySelection() {
    return anchor || (selection.length ? selection[selection.length - 1] : null);
  }
  // Notify the host (e.g. the piano roll, backlog #25) whenever the selection
  // changes so it can follow the selected clip.
  function notifySelection() {
    if (cfg.onSelectionChange) {
      const p = primarySelection();
      cfg.onSelectionChange(p ? { trackId: p.trackId, clipId: p.clipId } : null);
    }
  }

  el.classList.add('arranger');

  // ---- track visibility (backlog #23) ------------------------------------
  // A lane is hidden when its parent folder is collapsed. A collapsed lane
  // without children shrinks to just its header; a collapsed folder stays full
  // height so its own header/clips remain reachable.
  function laneHidden(tr, tracks) {
    if (!tr.folder) return false;
    const parent = tracks.find(x => x.id === tr.folder);
    return !!parent && parent.collapsed;
  }
  function laneHeightOf(tr, tracks) {
    if (tr.collapsed && !tracks.some(x => x.folder === tr.id)) return COLLAPSED_HEIGHT;
    return tr.height || laneHeight;
  }

  // ---- toolbar ------------------------------------------------------
  const toolbar = document.createElement('div');
  toolbar.className = 'arranger-toolbar';

  const title = document.createElement('span');
  title.className = 'arranger-title';
  title.textContent = 'ARRANGER';

  const zoomOut = document.createElement('button');
  zoomOut.className = 'arranger-btn';
  zoomOut.textContent = '−';
  zoomOut.title = 'Zoom out';
  zoomOut.addEventListener('click', () => setZoom(zoom / 1.25));

  const zoomLabel = document.createElement('span');
  zoomLabel.className = 'arranger-zoom-label';

  const zoomIn = document.createElement('button');
  zoomIn.className = 'arranger-btn';
  zoomIn.textContent = '+';
  zoomIn.title = 'Zoom in';
  zoomIn.addEventListener('click', () => setZoom(zoom * 1.25));

  const addClip = document.createElement('button');
  addClip.className = 'arranger-btn';
  addClip.textContent = '+ clip';
  addClip.title = 'Add clip to the active track';
  addClip.addEventListener('click', () => addClipToActiveTrack());

  const splitBtn = document.createElement('button');
  splitBtn.className = 'arranger-btn';
  splitBtn.textContent = 'split';
  splitBtn.title = 'Split the selected clip at the playhead (S)';
  splitBtn.addEventListener('click', () => splitSelectedClipAtPlayhead());

  const dupBtn = document.createElement('button');
  dupBtn.className = 'arranger-btn';
  dupBtn.textContent = 'dup';
  dupBtn.title = 'Duplicate the selected clip (D)';
  dupBtn.addEventListener('click', () => duplicateSelectedClip());

  const loopBtn = document.createElement('button');
  loopBtn.className = 'arranger-btn';
  loopBtn.textContent = 'loop';
  loopBtn.title = 'Loop the selected clip 3x (L)';
  loopBtn.addEventListener('click', () => loopSelectedClip());

  const markerBtn = document.createElement('button');
  markerBtn.className = 'arranger-btn';
  markerBtn.textContent = '+ mrk';
  markerBtn.title = 'Add a marker at the playhead';
  markerBtn.addEventListener('click', () => addMarkerAtPlayhead());

  const loopToggle = document.createElement('button');
  loopToggle.className = 'arranger-btn';
  loopToggle.textContent = 'loop';
  loopToggle.title = 'Toggle loop playback (loops the region between locators)';
  loopToggle.addEventListener('click', () => {
    transport.setLoopEnabled(!transport.loopEnabled);
    render();
  });

  const endMarkerBtn = document.createElement('button');
  endMarkerBtn.className = 'arranger-btn';
  endMarkerBtn.textContent = '+ end';
  endMarkerBtn.title = 'Set project end marker at the playhead';
  endMarkerBtn.addEventListener('click', () => {
    transport.setProjectEnd(playheadTicks);
    render();
  });

  toolbar.append(title, zoomOut, zoomLabel, zoomIn, addClip, splitBtn, dupBtn, loopBtn, markerBtn, loopToggle, endMarkerBtn);

  // ---- scroll viewport + content -------------------------------------
  const scroll = document.createElement('div');
  scroll.className = 'arranger-scroll';

  const content = document.createElement('div');
  content.className = 'arranger-content';

  const rulerEl = document.createElement('div');
  rulerEl.className = 'arranger-ruler';
  rulerEl.style.height = rulerHeight + 'px';

  const lanesEl = document.createElement('div');
  lanesEl.className = 'arranger-lanes';

  const playheadEl = document.createElement('div');
  playheadEl.className = 'arranger-playhead';
  playheadEl.style.height = '100%';

  content.append(rulerEl, lanesEl, playheadEl);
  scroll.appendChild(content);
  el.append(toolbar, scroll);

  function setZoom(z) {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    render();
  }

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // Add a MIDI clip to the active track (or the first one) at the next free
  // position on the timeline. Runs through the command history so undo works.
  function addClipToActiveTrack() {
    const tracks = (engine.getTracks && engine.getTracks()) || [];
    if (!tracks.length) return;
    const targetId = (engine.activeTrackId && tracks.some(t => t.id === engine.activeTrackId))
      ? engine.activeTrackId
      : tracks[0].id;
    const target = tracks.find(t => t.id === targetId);
    const nextStart = (target.clips || []).reduce((max, c) => Math.max(max, c.start + c.length), 0);
    const clip = {
      name: 'Clip ' + ((target.clips || []).length + 1),
      start: nextStart,
      length: (transport.ppq || 480) * 4, // one 4/4 bar
    };
    if (history && history.execute) {
      history.execute(addClipCommand(engine, targetId, clip));
    } else {
      engine.addClip(targetId, clip);
      render();
    }
  }

  // Split the primary selected clip at the playhead position (absolute ticks).
  // The split goes through the command history so undo restores the original.
  // If the playhead sits outside the clip, the clip is split at its midpoint.
  function splitSelectedClipAtPlayhead() {
    const sel = primarySelection();
    if (!sel) return;
    const { trackId, clipId } = sel;
    const t = (engine.getTracks() || []).find(t => t.id === trackId);
    const clip = t && (t.clips || []).find(c => c.id === clipId);
    if (!clip) return;
    const atTicks = (playheadTicks > clip.start && playheadTicks < clip.start + clip.length)
      ? playheadTicks
      : clip.start + Math.floor(clip.length / 2);
    if (history && history.execute) {
      history.execute(splitClipCommand(engine, trackId, clipId, atTicks));
    } else {
      engine.splitClip(trackId, clipId, atTicks);
      render();
    }
  }

  // Duplicate the primary selected clip: a copy is placed right after it.
  function duplicateSelectedClip() {
    const sel = primarySelection();
    if (!sel) return;
    const { trackId, clipId } = sel;
    if (history && history.execute) {
      history.execute(duplicateClipCommand(engine, trackId, clipId));
    } else {
      engine.duplicateClip(trackId, clipId);
      render();
    }
  }

  // Loop the primary selected clip: repeat it 3x back-to-back (via history).
  function loopSelectedClip() {
    const sel = primarySelection();
    if (!sel) return;
    const { trackId, clipId } = sel;
    if (history && history.execute) {
      history.execute(repeatClipCommand(engine, trackId, clipId, 3));
    } else {
      engine.repeatClip(trackId, clipId, 3);
      render();
    }
  }

  // Add a marker at the current playhead position (undoable).
  function addMarkerAtPlayhead() {
    if (!markers) return;
    const tick = playheadTicks;
    const n = markers.getMarkers().length + 1;
    const cfg = { name: 'M' + n, tick };
    if (history && history.execute) {
      history.execute(addMarkerCommand(markers, cfg));
    } else {
      markers.add(cfg);
      render();
    }
  }

  // Click-to-select and pointer-drag to move a clip. A small movement threshold
  // keeps a plain click from being treated as a (zero-distance) drag; moving the
  // clip writes through the command history so undo restores the old position.
  // Positions snap to the nearest sixteenth-note grid line (snapTicks).
  // Map a viewport X to musical ticks inside the scrollable content, accounting
  // for the content's page position and the current scroll offset.
  function clientXToTicks(clientX) {
    const ppq = transport.ppq || 480;
    const rect = content.getBoundingClientRect();
    const contentX = clientX - rect.left + scroll.scrollLeft;
    return xToTicks(contentX, { pxPerQuarter: zoom, ppq });
  }

  function onClipPointerDown(e, block, trackId, clipId) {
    const src = (engine.getTracks() || []).find(t => t.id === trackId);
    const clip = src && (src.clips || []).find(c => c.id === clipId);
    if (!clip || !src) return;

    // Backlog #15: multi-select / range select.
    // Ctrl/Cmd+click toggles the clip in the selection; Shift+click selects a
    // range of clips on the anchor's track between anchor and this clip; a plain
    // click keeps any existing multi-selection (so a selected group can be
    // dragged together) unless the clicked clip is not part of it.
    if (e.ctrlKey || e.metaKey) {
      if (isSelected(trackId, clipId)) {
        selection = selection.filter(s => !(s.trackId === trackId && s.clipId === clipId));
        if (anchor && anchor.trackId === trackId && anchor.clipId === clipId) {
          anchor = selection.length ? selection[selection.length - 1] : null;
        }
      } else {
        selection = selection.concat({ trackId, clipId });
        anchor = { trackId, clipId };
      }
      render();
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    if (e.shiftKey && anchor) {
      const aTrack = (engine.getTracks() || []).find(t => t.id === anchor.trackId);
      const aClip = aTrack && (aTrack.clips || []).find(c => c.id === anchor.clipId);
      if (aClip) {
        const lo = Math.min(aClip.start, clip.start);
        const hi = Math.max(aClip.start, clip.start);
        // Range = every clip on the anchor's track that starts inside [lo, hi].
        (aTrack.clips || []).forEach(c => {
          if (c.start >= lo && c.start <= hi && !isSelected(anchor.trackId, c.id)) {
            selection = selection.concat({ trackId: anchor.trackId, clipId: c.id });
          }
        });
        if (!isSelected(trackId, clipId)) selection = selection.concat({ trackId, clipId });
        anchor = { trackId, clipId };
        render();
      }
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    // Plain click: select this clip (keep the group if it is already selected,
    // so multi-select drags work; otherwise collapse to just this clip).
    if (!isSelected(trackId, clipId)) {
      selection = [{ trackId, clipId }];
    }
    anchor = { trackId, clipId };

    // Drag: move the whole selected set together. Capture each clip's pre-drag
    // start so onDrop can delta-shift them all through one command.
    const clips = selection.map(s => {
      const t2 = (engine.getTracks() || []).find(t => t.id === s.trackId);
      const c2 = t2 && (t2.clips || []).find(c => c.id === s.clipId);
      return { trackId: s.trackId, clipId: s.clipId, startTicks: c2 ? c2.start : 0 };
    });
    drag = {
      trackId, clipId,
      grabTicks: clientXToTicks(e.clientX),
      startTicks: clip.start,
      clips,
    };
    if (block.setPointerCapture) { try { block.setPointerCapture(e.pointerId); } catch (err) {} }
    block.classList.add('dragging');
    block.addEventListener('pointermove', onClipDrag);
    block.addEventListener('pointerup', onClipDrop);
    block.addEventListener('pointercancel', onClipDrop);
    e.stopPropagation();
    e.preventDefault();
  }

  function onClipDrag(e) {
    if (!drag) return;
    const ppq = transport.ppq || 480;
    const deltaTicks = clientXToTicks(e.clientX) - drag.grabTicks;
    const targetStart = snapTicks(drag.startTicks + deltaTicks, { ppq });
    const delta = targetStart - drag.startTicks;
    // Live-preview: shift every selected clip block by the same delta.
    (drag.clips || []).forEach(s => {
      const t = (engine.getTracks() || []).find(t => t.id === s.trackId);
      const clip = t && (t.clips || []).find(c => c.id === s.clipId);
      if (!clip) return;
      const lane = lanesEl.querySelector('.arranger-lane[data-id="' + s.trackId + '"]');
      const block = lane && lane.querySelector('.arranger-clip[data-id="' + s.clipId + '"]');
      if (!block) return;
      const x = ticksToX(Math.max(0, s.startTicks + delta), { pxPerQuarter: zoom, ppq });
      block.style.left = x + 'px';
    });
    drag.previewTicks = targetStart;
    drag.previewDelta = delta;
  }

  function onClipDrop(e) {
    if (!drag) return;
    const { trackId, clipId, startTicks, clips } = drag;
    const finalTicks = typeof drag.previewTicks === 'number' ? drag.previewTicks : startTicks;
    const delta = (typeof drag.previewDelta === 'number' ? drag.previewDelta : 0);
    drag = null;
    const block = e.target;
    if (block.releasePointerCapture && e.pointerId !== undefined) {
      try { block.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    block.removeEventListener('pointermove', onClipDrag);
    block.removeEventListener('pointerup', onClipDrop);
    block.removeEventListener('pointercancel', onClipDrop);
    // A multi-selection drag moves every selected clip by the same delta in a
    // single undoable command; a single clip keeps the original move command.
    const movingMany = (clips && clips.length > 1 && delta !== 0);
    if (finalTicks !== startTicks || movingMany) {
      if (history && history.execute) {
        if (movingMany) {
          const items = clips.map(s => ({ trackId: s.trackId, clipId: s.clipId }));
          history.execute(moveClipsCommand(engine, items, delta));
        } else {
          history.execute(moveClipCommand(engine, trackId, clipId, { start: finalTicks }));
        }
      } else if (movingMany) {
        clips.forEach(s => engine.moveClip(s.trackId, s.clipId, { start: Math.max(0, s.startTicks + delta) }));
        render();
      } else {
        engine.moveClip(trackId, clipId, { start: finalTicks });
        render();
      }
    } else {
      render();
    }
  }

  // Trim a clip by dragging its left/right edge. The edge under the pointer is
  // a `.arranger-clip-edge` div; dragging moves that edge and rewrites
  // start/length (snapped) through the command history.
  function onEdgePointerDown(e, edgeEl, trackId, clipId, edge) {
    const src = (engine.getTracks() || []).find(t => t.id === trackId);
    const clip = src && (src.clips || []).find(c => c.id === clipId);
    if (!clip || !src) return;
    // Trim targets the primary clip: fold the selection to it on a plain click,
    // or just make it the anchor (kept in a multi-selection) otherwise.
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !isSelected(trackId, clipId)) {
      selection = [{ trackId, clipId }];
    }
    if (!isSelected(trackId, clipId)) selection = selection.concat({ trackId, clipId });
    anchor = { trackId, clipId };
    resize = {
      trackId, clipId, edge,
      grabTicks: clientXToTicks(e.clientX),
      startTicks: clip.start,
      endTicks: clip.start + clip.length,
    };
    if (edgeEl.setPointerCapture) { try { edgeEl.setPointerCapture(e.pointerId); } catch (err) {} }
    edgeEl.classList.add('dragging');
    edgeEl.addEventListener('pointermove', onEdgeDrag);
    edgeEl.addEventListener('pointerup', onEdgeDrop);
    edgeEl.addEventListener('pointercancel', onEdgeDrop);
    e.stopPropagation();
    e.preventDefault();
  }

  function onEdgeDrag(e) {
    if (!resize) return;
    const ppq = transport.ppq || 480;
    const deltaTicks = clientXToTicks(e.clientX) - resize.grabTicks;
    let startTicks = resize.startTicks;
    let endTicks = resize.endTicks;
    if (resize.edge === 'right') {
      endTicks = snapTicks(resize.endTicks + deltaTicks, { ppq });
      endTicks = Math.max(endTicks, resize.startTicks + snapTicks(ppq / 4, { ppq }));
    } else {
      startTicks = snapTicks(resize.startTicks + deltaTicks, { ppq });
      startTicks = Math.max(0, Math.min(startTicks, resize.endTicks - snapTicks(ppq / 4, { ppq })));
    }
    // Live-preview the new span on the DOM block.
    const lane = lanesEl.querySelector('.arranger-lane[data-id="' + resize.trackId + '"]');
    const block = lane && lane.querySelector('.arranger-clip[data-id="' + resize.clipId + '"]');
    if (!block) return;
    const x = ticksToX(startTicks, { pxPerQuarter: zoom, ppq });
    const w = ticksToX(endTicks, { pxPerQuarter: zoom, ppq }) - x;
    block.style.left = x + 'px';
    block.style.width = Math.max(1, w) + 'px';
    resize.preview = { startTicks, endTicks };
  }

  function onEdgeDrop(e) {
    if (!resize) return;
    const { trackId, clipId, startTicks, endTicks } = resize;
    const preview = resize.preview || { startTicks, endTicks };
    resize = null;
    const edgeEl = e.target;
    if (edgeEl.releasePointerCapture && e.pointerId !== undefined) {
      try { edgeEl.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    edgeEl.classList.remove('dragging');
    edgeEl.removeEventListener('pointermove', onEdgeDrag);
    edgeEl.removeEventListener('pointerup', onEdgeDrop);
    edgeEl.removeEventListener('pointercancel', onEdgeDrop);
    const newStart = preview.startTicks;
    const newLength = Math.max(1, preview.endTicks - preview.startTicks);
    if (newStart !== startTicks || newLength !== (endTicks - startTicks)) {
      const patch = {};
      if (newStart !== startTicks) patch.start = newStart;
      if (newLength !== (endTicks - startTicks)) patch.length = newLength;
      if (history && history.execute) {
        history.execute(moveClipCommand(engine, trackId, clipId, patch));
      } else {
        engine.moveClip(trackId, clipId, patch);
        render();
      }
    } else {
      render();
    }
  }

  function render() {
    const ppq = transport.ppq || 480;
    const tempoMap = transport.tempoMap;
    const tracks = engine.getTracks() || [];
    const ruler = computeRuler(tempoMap, bars, { pxPerQuarter: zoom, ppq });
    const totalW = Math.max(400, (contentWidthTicks(tempoMap, bars) / ppq) * zoom);

    // Sync loop toggle button state.
    loopToggle.classList.toggle('on', !!transport.loopEnabled);
    loopToggle.title = transport.loopEnabled
      ? 'Loop is ON (click to disable) — ' + transport.loopStartTicks + '–' + transport.loopEndTicks + ' ticks'
      : 'Toggle loop playback (loops the region between locators)';

    content.style.width = totalW + 'px';
    content.style.height = (rulerHeight + tracks.reduce((acc, tr) => acc + (laneHidden(tr, tracks) ? 0 : laneHeightOf(tr, tracks)), 0)) + 'px';

    // ---- ruler ----
    clearChildren(rulerEl);
    ruler.forEach(b => {
      const cell = document.createElement('div');
      cell.className = 'arranger-bar';
      cell.style.left = b.x + 'px';
      cell.style.width = b.width + 'px';
      cell.textContent = (b.bar + 1);
      cell.title = 'Bar ' + (b.bar + 1);
      rulerEl.appendChild(cell);
    });

    // ---- markers (backlog #16) ----
    // Named positions on the timeline: rendered on the ruler, click = seek,
    // the × button removes the marker (undoable).
    (markers ? markers.getMarkers() : []).forEach(m => {
      const flag = document.createElement('div');
      flag.className = 'arranger-marker';
      flag.style.left = ticksToX(m.tick, { pxPerQuarter: zoom, ppq }) + 'px';
      flag.title = m.name + ' · ' + m.tick + ' ticks';
      const label = document.createElement('span');
      label.className = 'arranger-marker-label';
      label.textContent = m.name;
      const del = document.createElement('button');
      del.className = 'arranger-marker-del';
      del.textContent = '×';
      del.title = 'Remove marker';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (history && history.execute) {
          history.execute(removeMarkerCommand(markers, m.id));
        } else {
          markers.remove(m.id);
          render();
        }
      });
      flag.addEventListener('click', () => {
        if (transport && transport.seek) transport.seek(m.tick);
      });
      flag.append(label, del);
      rulerEl.appendChild(flag);
    });

    // ---- loop region (backlog #155) ----
    // A shaded band on the ruler between loopStartTicks and loopEndTicks.
    // Clicking the band toggles loop on/off; dragging the edges resizes.
    if (transport.loopEnabled) {
      const loopRegion = document.createElement('div');
      loopRegion.className = 'arranger-loop-region';
      const lx = ticksToX(transport.loopStartTicks, { pxPerQuarter: zoom, ppq });
      const rx = ticksToX(transport.loopEndTicks, { pxPerQuarter: zoom, ppq });
      loopRegion.style.left = lx + 'px';
      loopRegion.style.width = (rx - lx) + 'px';
      loopRegion.style.height = rulerHeight + 'px';
      loopRegion.title = 'Loop: ' + transport.loopStartTicks + '–' + transport.loopEndTicks + ' ticks (click to disable)';
      loopRegion.addEventListener('click', () => {
        transport.setLoopEnabled(false);
        render();
      });

      // Left edge drag handle.
      const leftEdge = document.createElement('div');
      leftEdge.className = 'arranger-loop-edge arranger-loop-edge-l';
      loopRegion.appendChild(leftEdge);
      leftEdge.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const startX = e.clientX;
        const startVal = transport.loopStartTicks;
        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          const dtick = Math.round(dx / zoom * ppq);
          const newStart = Math.max(0, Math.min(startVal + dtick, transport.loopEndTicks - 1));
          transport.loopStartTicks = newStart;
          render();
        };
        const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });

      // Right edge drag handle.
      const rightEdge = document.createElement('div');
      rightEdge.className = 'arranger-loop-edge arranger-loop-edge-r';
      loopRegion.appendChild(rightEdge);
      rightEdge.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const startX = e.clientX;
        const startVal = transport.loopEndTicks;
        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          const dtick = Math.round(dx / zoom * ppq);
          const newEnd = Math.max(transport.loopStartTicks + 1, startVal + dtick);
          transport.loopEndTicks = newEnd;
          render();
        };
        const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });

      rulerEl.appendChild(loopRegion);
    }

    // ---- project end marker (backlog #155) ----
    if (transport.projectEndTicks !== null) {
      const endMarker = document.createElement('div');
      endMarker.className = 'arranger-project-end';
      endMarker.style.left = ticksToX(transport.projectEndTicks, { pxPerQuarter: zoom, ppq }) + 'px';
      endMarker.style.height = rulerHeight + 'px';
      endMarker.title = 'Project end: ' + transport.projectEndTicks + ' ticks (click to remove)';
      endMarker.addEventListener('click', () => {
        transport.setProjectEnd(null);
        render();
      });
      rulerEl.appendChild(endMarker);
    }

    // ---- lanes ----
    clearChildren(lanesEl);
    tracks.forEach((t, ti) => {
      const lane = document.createElement('div');
      lane.className = 'arranger-lane' + (t.muted ? ' muted' : '') + (t.solo ? ' solo' : '') + (laneHidden(t, tracks) ? ' collapsed-child' : '');
      lane.style.height = laneHeightOf(t, tracks) + 'px';
      lane.dataset.id = t.id;
      if (laneHidden(t, tracks)) lane.style.display = 'none';

      // Track header: name + M/S toggles (backlog #17). Clicking M or S runs an
      // undoable command through history (falls back to a direct update).
      const header = document.createElement('span');
      header.className = 'arranger-lane-header';
      const label = document.createElement('span');
      label.className = 'arranger-lane-label';
      label.textContent = t.name;
      label.style.color = t.color;
      label.title = 'Double-click to rename';
      label.addEventListener('dblclick', () => {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'arranger-lane-label-input';
        input.value = t.name;
        let done = false;
        const commit = () => {
          if (done) return;
          done = true;
          const v = input.value.trim();
          if (v && v !== t.name) {
            if (history && history.execute) history.execute(renameTrackCommand(engine, t.id, v));
            else engine.updateTrack(t.id, { name: v });
          }
          render();
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') { done = true; render(); }
        });
        input.addEventListener('blur', commit);
        label.replaceWith(input);
        input.focus();
        input.select();
      });

      // Track color (backlog #20): a color input in the lane header drives the
      // accent used by clips and legacy blocks on this lane.
      const colorIn = document.createElement('input');
      colorIn.type = 'color';
      colorIn.className = 'arranger-lane-color';
      colorIn.value = t.color || '#4af74a';
      colorIn.title = 'Track color';
      colorIn.addEventListener('input', () => {
        if (history && history.execute) history.execute(updateTrackCommand(engine, t.id, { color: colorIn.value }));
        else engine.updateTrack(t.id, { color: colorIn.value });
        render();
      });
      const mkFlagBtn = (ch, active, onClick) => {
        const b = document.createElement('button');
        b.className = 'arranger-lane-flag' + (ch === 'MNT' ? ' arranger-lane-monitor' : '') + (active ? ' on' : '');
        b.textContent = ch;
        const key = ch === 'M' ? 'muted' : ch === 'S' ? 'solo' : 'monitor';
        const titles = ch === 'M'
          ? (t.muted ? 'Unmute track' : 'Mute track')
          : ch === 'S' ? (t.solo ? 'Unsolo track' : 'Solo track')
          : (t.monitor ? 'Disable input monitor' : 'Enable input monitor');
        b.title = titles;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const cur = ch === 'M' ? t.muted : ch === 'S' ? t.solo : t.monitor;
          if (history && history.execute) {
            history.execute(setTrackFlagCommand(engine, t.id, key, !cur));
          } else {
            engine.updateTrack(t.id, { [key]: !cur });
            render();
          }
        });
        return b;
      };
      // Track reorder buttons (backlog #19): move the lane up/down in the list
      // as an undoable command. The first/last lane's inactive button is dimmed.
      const mkReorderBtn = (ch, targetIdx) => {
        const b = document.createElement('button');
        b.className = 'arranger-lane-reorder';
        b.textContent = ch;
        b.title = ch === '▲' ? 'Move track up' : 'Move track down';
        const tl = tracks.length;
        if ((ch === '▲' && ti === 0) || (ch === '▼' && ti === tl - 1)) b.classList.add('dim');
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (history && history.execute) {
            history.execute(reorderTrackCommand(engine, t.id, targetIdx));
          } else {
            engine.reorderTrack(t.id, targetIdx);
            render();
          }
        });
        return b;
      };
      // Track collapse (backlog #23): toggling collapses the lane itself (when
      // it has no children) or the children of a folder lane. Undoable.
      const mkCollapseBtn = (tr) => {
        const b = document.createElement('button');
        b.className = 'arranger-lane-collapse';
        b.textContent = tr.collapsed ? '▸' : '▾';
        b.title = tr.collapsed ? 'Expand track' : 'Collapse track';
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (history && history.execute) {
            history.execute(updateTrackCommand(engine, tr.id, { collapsed: !tr.collapsed }));
          } else {
            engine.updateTrack(tr.id, { collapsed: !tr.collapsed });
            render();
          }
        });
        return b;
      };
      header.append(
        mkReorderBtn('▲', ti - 1),
        mkReorderBtn('▼', ti + 1),
        mkFlagBtn('M', t.muted, null),
        mkFlagBtn('S', t.solo, null),
        mkFlagBtn('MNT', t.monitor, null),
        mkCollapseBtn(t),
        label,
        colorIn,
      );
      lane.appendChild(header);

      // Track lane resize handle (backlog #22): drag the bottom edge of the
      // lane to change its height; the new height is an undoable command.
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'arranger-lane-resize';
      resizeHandle.title = 'Drag to resize lane';
      resizeHandle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startY = e.clientY;
        const startH = t.height || laneHeight;
        let lastH = startH;
        const onMove = (ev) => {
          const h = Math.max(26, Math.min(240, startH + (ev.clientY - startY)));
          if (h !== lastH) {
            lastH = h;
            lane.style.height = h + 'px';
            content.style.height = (rulerHeight + tracks.reduce((acc, tr) => acc + (tr.id === t.id ? h : (laneHidden(tr, tracks) ? 0 : laneHeightOf(tr, tracks))), 0)) + 'px';
          }
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (lastH !== startH && lastH !== (t.height || laneHeight)) {
            if (history && history.execute) history.execute(resizeTrackCommand(engine, t.id, lastH));
            else engine.updateTrack(t.id, { height: lastH });
            render();
          }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
      lane.appendChild(resizeHandle);

      // A track with MIDI clips renders them on the timeline; a track without
      // clips keeps the legacy 16-step pattern blocks so old projects still show.
      const clips = Array.isArray(t.clips) ? t.clips : [];
      if (clips.length) {
        layoutClips(t, { pxPerQuarter: zoom, ppq }).forEach(c => {
          const block = document.createElement('div');
          block.className = 'arranger-clip';
          block.dataset.id = c.id;
          block.style.left = c.x + 'px';
          block.style.width = c.width + 'px';
          block.style.setProperty('--bcolor', c.color || t.color);
          block.textContent = c.name;
          block.title = c.name + ' · ' + c.startTicks + ' → ' + (c.startTicks + c.lengthTicks) + ' ticks';
          block.dataset.track = t.id;
          if (isSelected(t.id, c.id)) block.classList.add('selected');
          if (drag && drag.trackId === t.id && drag.clipId === c.id) block.classList.add('dragging');
          block.addEventListener('pointerdown', (e) => onClipPointerDown(e, block, t.id, c.id));
          lane.appendChild(block);

          // Trim handles: a thin zone on each vertical edge (over the mini-notes).
          const edgeLeft = document.createElement('div');
          edgeLeft.className = 'arranger-clip-edge arranger-clip-edge-l';
          edgeLeft.title = 'Trim left edge';
          edgeLeft.addEventListener('pointerdown', (e) => onEdgePointerDown(e, edgeLeft, t.id, c.id, 'left'));
          block.appendChild(edgeLeft);

          const edgeRight = document.createElement('div');
          edgeRight.className = 'arranger-clip-edge arranger-clip-edge-r';
          edgeRight.title = 'Trim right edge';
          edgeRight.addEventListener('pointerdown', (e) => onEdgePointerDown(e, edgeRight, t.id, c.id, 'right'));
          block.appendChild(edgeRight);

          // Backlog #9: notes live inside the clip; render them as mini-notes
          // within the clip block (clips carry events in PPQ ticks).
          const srcClip = t.clips.find(cl => cl.id === c.id);
          if (srcClip && (srcClip.events || []).length) {
            layoutClipNotes(srcClip, { pxPerQuarter: zoom, ppq }).forEach(n => {
              const note = document.createElement('div');
              note.className = 'arranger-clip-note';
              note.style.left = n.x + 'px';
              note.style.width = n.width + 'px';
              note.title = n.note;
              block.appendChild(note);
            });
          }
        });
      } else {
        layoutTrackBlocks(t, { bars, pxPerQuarter: zoom, ppq }).forEach(blk => {
          const block = document.createElement('div');
          block.className = 'arranger-block';
          block.style.left = blk.x + 'px';
          block.style.width = blk.width + 'px';
          block.style.setProperty('--bcolor', t.color);
          block.textContent = blk.note;
          block.title = blk.note + ' · ' + blk.dur + (blk.dur === 1 ? ' step' : ' steps');
          lane.appendChild(block);
        });
      }

      lanesEl.appendChild(lane);
    });

    zoomLabel.textContent = zoom + ' px/beat';
    updatePlayhead();
    notifySelection();
  }

  function updatePlayhead() {
    const ppq = transport.ppq || 480;
    const x = ticksToX(playheadTicks, { pxPerQuarter: zoom, ppq });
    playheadEl.style.left = x + 'px';
  }

  // ---- transport wiring -------------------------------------------------
  transport.onTick((info) => {
    playheadTicks = (info.loopCount || 0) * (transport.loopLenTicks || 4 * (transport.ppq || 480)) + info.loopPosTicks;
    updatePlayhead();
  });

  transport.onStop(() => {
    playheadTicks = 0;
    updatePlayhead();
  });

  if (history) history.subscribe(() => render());
  if (markers && markers.subscribe) markers.subscribe(() => render());

  // ---- clip selection + delete -----------------------------------------
  // Clicking empty lane space clears the current clip selection.
  lanesEl.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('arranger-clip')) return;
    if (e.target.classList.contains('arranger-clip-note')) return;
    if (e.target.classList.contains('arranger-clip-edge')) return;
    selection = [];
    anchor = null;
    render();
  });

  // Delete removes all selected clips through the command history (undoable).
  document.addEventListener('keydown', (e) => {
    // Don't edit when the user is typing into an input/select.
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (!selection.length) return;
      const items = selection.slice();
      selection = [];
      anchor = null;
      if (history && history.execute) {
        history.execute(removeClipsCommand(engine, items));
      } else {
        items.forEach(({ trackId, clipId }) => engine.removeClip(trackId, clipId));
        render();
      }
      return;
    }
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      splitSelectedClipAtPlayhead();
      return;
    }
    if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      duplicateSelectedClip();
      return;
    }
    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      loopSelectedClip();
      return;
    }
  });

  // ---- zoom via ctrl+wheel --------------------------------------------
  scroll.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(e.deltaY < 0 ? zoom * 1.25 : zoom / 1.25);
  }, { passive: false });

  render();

  return { el, render, setZoom, updatePlayhead };
}
