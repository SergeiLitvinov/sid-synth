import { createProjectSession } from '../src/project/projectSession.js';
import { defaultProject } from '../src/project/defaultProject.js';
import { createTrackEngine } from '../src/tracks/trackEngine.js';
import { createMockAudioContext } from './mockAudioContext.js';
import { createHistory } from '../src/project/history.js';
import { createMarkerStore } from '../src/project/markers.js';
import { importBundle } from '../src/project/projectFiles.js';

let passed = 0, failed = 0;
async function check(name, fn) {
  const li = document.createElement('li');
  try { if (await fn() === false) throw new Error('assertion returned false'); passed++; li.textContent = 'PASS ' + name; }
  catch (e) { failed++; li.className = 'fail'; li.textContent = 'FAIL ' + name + ': ' + e.message; }
  document.getElementById('results').appendChild(li);
}
function fixture() {
  const ctx = createMockAudioContext(), engine = createTrackEngine(ctx, ctx.destination);
  engine.addTrack({ id: 'old' }); engine.selectTrack('old');
  const history = createHistory(), markers = createMarkerStore({ markers: [{ id: 'm1', tick: 10 }] });
  let assets = [{ hash: 'oldAudio' }], rackCommits = 0, rackDisposals = 0, rackFails = false;
  const transport = { ppq: 480, loopEnabled: true, loopStartTicks: 10, loopEndTicks: 100, projectEndTicks: 200 };
  const session = createProjectSession({ components: {}, router: { connections: [] },
    prepareRack() { if (rackFails) throw new Error('rack allocation failed'); return { commit() { rackCommits++; }, dispose() { rackDisposals++; } }; },
    trackEngine: engine, transport, markers, history, getAssets: () => assets, setAssets: a => { assets = a; } });
  return { ctx, engine, history, markers, session, transport,
    get commits() { return rackCommits; }, get disposals() { return rackDisposals; },
    failRack() { rackFails = true; },
    snapshot: () => JSON.stringify({ tracks: engine.getTracks(), tempo: engine.bpm, active: engine.activeTrackId, assets, markers: markers.getMarkers(), transport }),
  };
}
for (const [name, mutate] of [
  ['duplicate tracks', p => p.tracks = [{ id: 'new' }, { id: 'new' }]],
  ['invalid number', p => p.tempo = Infinity],
  ['invalid asset reference', p => p.tracks = [{ id: 'new', clips: [{ audio: { hash: 'missing' } }] }]],
  ['future schema', p => p.schemaVersion = 999],
]) await check(name + ' leaves live state and resources unchanged', () => {
  const f = fixture(), before = f.snapshot(), oldVoice = f.engine.tracks[0].voice;
  const p = defaultProject(); mutate(p);
  let rejected = false;
  try { f.session.applyProject(p); } catch (_) { rejected = true; }
  const ok = rejected && f.snapshot() === before && f.commits === 0 && f.engine.tracks[0].voice === oldVoice;
  f.engine.dispose(); return ok;
});
await check('rack preparation failure preserves the old project', () => {
  const f = fixture(), before = f.snapshot(); f.failRack();
  let rejected = false;
  try { f.session.applyProject(defaultProject()); } catch (_) { rejected = true; }
  const ok = rejected && f.snapshot() === before && f.commits === 0;
  f.engine.dispose(); return ok;
});
await check('partial voice allocation failure disposes staged nodes and rack', () => {
  const f = fixture(), before = f.snapshot();
  const original = f.ctx.createGain, nodes = []; let count = 0;
  f.ctx.createGain = (...args) => {
    if (++count === 5) throw new Error('out of audio resources');
    const node = original(...args); let disconnected = false;
    const disconnect = node.disconnect.bind(node);
    node.disconnect = (...a) => { disconnected = true; disconnect(...a); };
    nodes.push(() => disconnected); return node;
  };
  let rejected = false;
  try { f.session.applyProject(defaultProject({ tracks: [{ id: 'new' }] })); } catch (_) { rejected = true; }
  const ok = rejected && f.snapshot() === before && f.disposals === 1 && f.commits === 0 && nodes.length > 0 && nodes.every(fn => fn());
  f.engine.dispose(); return ok;
});
await check('preparation owns its input and does not publish before commit', () => {
  const f = fixture(), before = f.snapshot();
  const p = defaultProject({ tracks: [{ id: 'new' }], tempo: 95, name: 'Prepared' });
  const staged = f.session.prepareProject(p);
  if (f.snapshot() !== before || f.commits) return false;
  p.tracks[0].id = 'changed'; p.tempo = 200;
  staged.commit();
  const ok = f.engine.tracks[0].id === 'new' && f.engine.bpm === 95 && f.session.getProjectName() === 'Prepared' && f.commits === 1;
  f.engine.dispose(); return ok;
});
await check('observers see the complete replacement once', () => {
  const f = fixture(); const snapshots = [];
  f.engine.onStateChange = () => snapshots.push({ tempo: f.engine.bpm, ids: f.engine.tracks.map(t => t.id), loop: f.transport.loopStartTicks });
  f.session.applyProject(defaultProject({ tracks: [{ id: 'new' }], tempo: 99, loopStartTicks: 50 }));
  const ok = snapshots.length === 1 && snapshots[0].tempo === 99 && snapshots[0].ids.join() === 'new' && snapshots[0].loop === 50;
  f.engine.dispose(); return ok;
});
await check('abandoned preparation preserves live state', () => {
  const f = fixture(), before = f.snapshot();
  const staged = f.session.prepareProject(defaultProject({ tracks: [{ id: 'new' }] })); staged.dispose();
  let rejected = false; try { staged.commit(); } catch (_) { rejected = true; }
  const ok = rejected && f.snapshot() === before && f.disposals === 1 && f.commits === 0;
  f.engine.dispose(); return ok;
});
await check('invalid bundle versions fail before media writes', async () => {
  let writes = 0;
  for (const bundleVersion of [undefined, null, 0, -1, 1.5, '1', NaN, Infinity, 2]) {
    try { await importBundle({ kind: 'sid-synth-bundle', bundleVersion, project: defaultProject(), media: [] }, { store: { put() { writes++; } } }); return false; }
    catch (_) {}
  }
  return writes === 0;
});
await check('invalid bundled project fails before any media writes', async () => {
  let writes = 0;
  try { await importBundle({ kind: 'sid-synth-bundle', bundleVersion: 1, project: { ...defaultProject(), tempo: -1 }, media: [{ hash: 'x', data: 'eA==' }] }, { store: { put() { writes++; } } }); return false; }
  catch (_) { return writes === 0; }
});
document.getElementById('summary').textContent = `${passed} passed, ${failed} failed`;
