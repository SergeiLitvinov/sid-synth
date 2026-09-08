// Real bootstrap test in an isolated browser profile supplied by the runner.
let passed = 0, failed = 0;
const errors = [];
function check(name, ok) {
  const li = document.createElement('li');
  li.textContent = (ok ? 'PASS ' : 'FAIL ') + name;
  document.getElementById('results').append(li);
  if (ok) passed++; else failed++;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) { if (fn()) return true; await wait(50); }
  return false;
}
const frame = document.createElement('iframe');
frame.style.width = '1100px';
frame.style.height = '800px';
const source = await (await fetch('../index.html')).text();
// Install error capture before the application's module imports execute.
frame.srcdoc = source.replace('<head>', '<head><base href="' + new URL('../', location.href).href + '"><script>window.addEventListener("error", e => parent.postMessage({ appError: e.message }, "*")); window.addEventListener("unhandledrejection", e => parent.postMessage({ appError: String(e.reason) }, "*"));</script>');
window.addEventListener('message', event => { if (event.source === frame.contentWindow && event.data?.appError) errors.push(event.data.appError); });
document.body.append(frame);
const ready = await until(() => frame.contentDocument?.querySelector('#inpRec'));
check('real application bootstrap reaches input panel', ready);
if (ready) {
  const doc = frame.contentDocument;
  check('initial track and arranger are mounted', doc.querySelectorAll('.rec-track').length === 1 && !!doc.querySelector('.arranger-toolbar'));
  const mode = doc.querySelector('#recPlaybackMode');
  check('new project starts in explicit SONG mode', mode?.value === 'song');
  doc.querySelector('#recAdd').click();
  check('ADD track is wired through extracted bootstrap', doc.querySelectorAll('.rec-track').length === 2);
  doc.querySelector('#recUndo').click();
  check('undo restores one track', doc.querySelectorAll('.rec-track').length === 1);
  doc.querySelector('.rec-cell').click();
  const saved = await until(() => {
    const project = JSON.parse(localStorage.getItem('sidSynthProject') || 'null');
    const loop = project?.tracks?.[0]?.clips?.find(c => c.start === 0);
    return !!loop && loop.events.length > 0;
  });
  check('musical edit reaches unified project autosave', saved);
  check('SONG mode is persisted with the project', JSON.parse(localStorage.getItem('sidSynthProject')).playbackMode === 'song');
  mode.value = 'pattern';
  mode.dispatchEvent(new frame.contentWindow.Event('change', { bubbles: true }));
  doc.querySelector('#recUndo').click();
  check('playback mode change is undoable in the UI', mode.value === 'song');
  const clip = doc.querySelector('.arranger-clip');
  clip.dispatchEvent(new frame.contentWindow.PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0 }));
  clip.dispatchEvent(new frame.contentWindow.PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  check('arranger selection opens piano roll and keeps step clip visible', !!doc.querySelector('.pr-body') && !!doc.querySelector('.rec-clip-select')?.value);
  check('guide link and save error status are discoverable', !!doc.querySelector('a[href="docs/USER_GUIDE.md"]') && !!doc.querySelector('#saveStatus[role="status"]'));
}
check('no uncaught bootstrap or interaction errors: ' + errors.join('; '), errors.length === 0);
frame.remove();
document.getElementById('summary').textContent = `${passed} passed, ${failed} failed`;
