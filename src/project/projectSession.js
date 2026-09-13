import { serializeProject, parseProject } from './serialize.js';
import { createProjectId } from './defaultProject.js';
import { captureParams } from '../services/componentParams.js';

// Coordinates one project load/save; the bootstrap only supplies its domains.
export function createProjectSession({
  components, router, prepareRack, trackEngine, transport,
  markers, history, recorderUI, arranger, getAssets, setAssets,
}) {
  let projectId = null;
  let projectName = 'SID Project';
  let createdAt = new Date().toISOString();
  let modifiedAt = createdAt;
  let lastContent = null;
  function captureProject() {
    if (!projectId) projectId = createProjectId();
    const project = serializeProject({
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
      createdAt, modifiedAt,
      loopEnabled: transport.loopEnabled,
      loopStartTicks: transport.loopStartTicks,
      loopEndTicks: transport.loopEndTicks,
      projectEndTicks: transport.projectEndTicks,
      assets: getAssets(),
    });
    const { createdAt: ignoredCreated, modifiedAt: ignoredModified, ...content } = project;
    const fingerprint = JSON.stringify(content);
    if (lastContent !== null && fingerprint !== lastContent) modifiedAt = new Date().toISOString();
    lastContent = fingerprint;
    project.modifiedAt = modifiedAt;
    return project;
  }

  function prepareProject(input) {
    const project = parseProject(input);
    let rack, tracks;
    try {
      rack = prepareRack(project.rack);
      tracks = trackEngine.prepareTracks(project.tracks);
    } catch (e) { rack?.dispose(); tracks?.dispose(); throw e; }
    let committed = false, disposed = false;
    return {
      dispose() { if (!committed && !disposed) { disposed = true; rack.dispose(); tracks.dispose(); } },
      commit() {
        if (committed || disposed) throw new Error('Project preparation is no longer available');
        // All validation, cloning, constructors and audio wiring have finished.
        // This synchronous commit never awaits external work.
        trackEngine.beginProjectReplacement();
        try {
          tracks.commit(project.activeTrackId);
          rack.commit();
          projectId = project.id;
          projectName = project.name;
          createdAt = project.createdAt;
          modifiedAt = project.modifiedAt;
          lastContent = null;
          setAssets(project.assets);
          trackEngine.playbackMode = project.playbackMode;
          trackEngine.bpm = project.tempo;
          trackEngine.recalcTempo();
          transport.loopEnabled = project.loopEnabled;
          transport.loopStartTicks = project.loopStartTicks;
          transport.loopEndTicks = project.loopEndTicks;
          transport.projectEndTicks = project.projectEndTicks;
          committed = true;
          markers.set(project.markers);
          history.reset();
        } finally { trackEngine.endProjectReplacement(); }
        if (recorderUI) recorderUI.renderAll();
        if (arranger) arranger.render();
      },
    };
  }

  function applyProject(input) {
    const prepared = prepareProject(input);
    try { prepared.commit(); } finally { prepared.dispose(); }
  }


  return { captureProject, prepareProject, applyProject, getProjectName: () => projectName, setProjectName: (n) => { projectName = String(n || 'SID Project'); } };
}
