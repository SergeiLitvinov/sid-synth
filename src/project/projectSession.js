import { serializeProject } from './serialize.js';
import { createProjectId } from './defaultProject.js';
import { normalizeAsset } from '../audio/assetStore.js';
import { captureParams, applyParams } from '../services/componentParams.js';

// Coordinates one project load/save; the bootstrap only supplies its domains.
export function createProjectSession({
  components, router, createComponent, clearRack, trackEngine, transport,
  markers, history, recorderUI, arranger, getAssets, setAssets,
}) {
  let projectId = null;
  let projectName = 'SID Project';
  function captureProject() {
    if (!projectId) projectId = createProjectId();
    return serializeProject({
      components,
      connections: router.connections,
      captureParams,
      tracks: trackEngine.getTracks(),
      tempo: trackEngine.bpm,
      playbackMode: trackEngine.playbackMode,
      activeTrackId: trackEngine.activeTrackId,
      markers: markers.getMarkers(),
      id: projectId,
      name: projectName,
      loopEnabled: transport.loopEnabled,
      loopStartTicks: transport.loopStartTicks,
      loopEndTicks: transport.loopEndTicks,
      projectEndTicks: transport.projectEndTicks,
      assets: getAssets(),
    });
  }

  function applyProject(project) {
    if (project.id) projectId = project.id;
    if (project.name) projectName = project.name;
    setAssets(Array.isArray(project.assets) ? project.assets.map(normalizeAsset) : []);

    // Rack: rebuild components + connections from the snapshot.
    clearRack();
    const idMap = {};
    (project.rack.components || []).forEach(c => {
      const before = new Set(Object.keys(components));
      const createId = (c.type === 'oscillator' && c.params && c.params.n) ? 'osc' + c.params.n : c.id;
      createComponent(c.type, createId, 0, 0);
      const createdId = Object.keys(components).find(id => !before.has(id));
      idMap[c.id] = createdId;
      if (createdId && components[createdId]) {
        components[createdId].element.style.left = (c.x || 0) + 'px';
        components[createdId].element.style.top = (c.y || 0) + 'px';
        applyParams(components[createdId], c.params);
      }
    });
    (project.rack.connections || []).forEach(conn => {
      const from = idMap[conn.from] ?? conn.from;
      const to = conn.to === 'master' ? 'master' : (idMap[conn.to] ?? conn.to);
      router.addConnection(from, to, conn.toChannel ?? null, conn.outChannel ?? 0);
    });
    router.drawConnections();

    // Replace via the engine lifecycle, including genuinely empty projects.
    trackEngine.stop();
    [...trackEngine.tracks].forEach(t => trackEngine.removeTrack(t.id));
    trackEngine.setPlaybackMode(project.playbackMode || 'pattern');
    if (project.tempo) { trackEngine.bpm = project.tempo; trackEngine.recalcTempo(); }
    (project.tracks || []).forEach(d => trackEngine.addTrack(d));
    trackEngine.activeTrackId = trackEngine.byId[project.activeTrackId]
      ? project.activeTrackId : (trackEngine.tracks[0]?.id || null);
    history.reset();
    if (recorderUI) recorderUI.renderAll();
    markers.set(Array.isArray(project.markers) ? project.markers : []);

    // Restore loop locators + project end.
    transport.loopEnabled = !!project.loopEnabled;
    transport.loopStartTicks = typeof project.loopStartTicks === 'number' ? project.loopStartTicks : 0;
    transport.loopEndTicks = typeof project.loopEndTicks === 'number' ? project.loopEndTicks : 4 * transport.ppq;
    transport.projectEndTicks = typeof project.projectEndTicks === 'number' ? project.projectEndTicks : null;

    if (arranger) arranger.render();
  }


  return { captureProject, applyProject };
}
