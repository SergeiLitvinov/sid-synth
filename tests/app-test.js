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
  for (let i = 0; i < 600; i++) { if (fn()) return true; await wait(50); }
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
const ready = await until(() => frame.contentDocument?.querySelector('#studio-arrange'));
check('real application bootstrap completes workspace composition', ready);
if (ready) {
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  const visible = el => !!el?.getClientRects().length;
  check('one project header and global transport are connected', doc.querySelectorAll('#recPlay').length === 1 && !!doc.querySelector('.studio-header #projSave') && !!doc.querySelector('.studio-transport #recPlay'));
  check('arrangement is the default view and rack is hidden', visible(doc.querySelector('#arranger')) && !visible(doc.querySelector('#rack')));
  const recorderPanel = doc.querySelector('#recorder');
  const rackPanel = doc.querySelector('#rack');
  doc.querySelector('#studio-rack').click();
  check('rack navigation preserves the live panel and global transport', visible(rackPanel) && !visible(recorderPanel) && visible(doc.querySelector('#recPlay')));
  doc.querySelector('#studio-arrange').click();
  doc.querySelector('#studio-tracks').focus();
  doc.querySelector('#studio-tracks').dispatchEvent(new win.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  check('editor tabs support arrow-key navigation and focus', doc.activeElement.id === 'studio-notes' && recorderPanel.hidden && doc.querySelector('#studio-notes').getAttribute('aria-selected') === 'true');
  doc.querySelector('#studio-tracks').click();
  check('tab round trip preserves editor identity', doc.querySelector('#recorder') === recorderPanel && visible(recorderPanel));
  const size = doc.querySelector('[aria-label="Высота редактора"]');
  size.value = '420'; size.dispatchEvent(new win.Event('input', { bubbles:true }));
  check('dock size control changes the actual panel height', Math.abs(recorderPanel.getBoundingClientRect().height - 420) < 2);
  size.value = '300'; size.dispatchEvent(new win.Event('input', { bubbles:true }));
  doc.querySelector('#studio-input').click();
  check('audio recording is separate from MIDI record', visible(doc.querySelector('#inpRec')) && visible(doc.querySelector('#recRecord')) && !visible(doc.querySelector('#mediaPool')));
  doc.querySelector('#studio-library').click();
  doc.querySelector('#recPlay').click();
  await until(() => !doc.querySelector('#studioPause').disabled);
  doc.querySelector('#studioPause').click();
  check('Pause is wired to transport state', doc.querySelector('#studioPause').getAttribute('aria-pressed') === 'true');
  const pausedPosition = doc.querySelector('.studio-position').textContent;
  await wait(100);
  check('Pause holds the displayed playhead', doc.querySelector('.studio-position').textContent === pausedPosition);
  doc.querySelector('#recPlay').click();
  check('Play resumes after Pause', doc.querySelector('#studioPause').getAttribute('aria-pressed') === 'false' && !doc.querySelector('#studioPause').disabled);
  doc.querySelector('#recStop').click();
  check('Stop resets playhead and disables Pause', doc.querySelector('.studio-position').textContent === '001 : 1' && doc.querySelector('#studioPause').disabled);
  check('initial track and arranger are mounted', doc.querySelectorAll('.rec-track').length === 1 && !!doc.querySelector('.arranger-toolbar'));
  const mode = doc.querySelector('#recPlaybackMode');
  check('new project starts in explicit SONG mode', mode?.value === 'song');
  doc.querySelector('#recAdd').click();
  check('ADD track is wired through extracted bootstrap', doc.querySelectorAll('.rec-track').length === 2);
  check('MIDI target follows the newly active track', doc.querySelector('.studio-input-target').textContent.includes('Track 2'));
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
  check('clip selection exposes the note tab', visible(doc.querySelector('#pianoRoll')) && recorderPanel.hidden);
  check('note transforms are collapsed without removing their controls', !doc.querySelector('.pr-transforms').open && !!doc.querySelector('.pr-transforms .pr-qrow'));
  const piano = doc.querySelector('#pianoRoll');
  piano.focus();
  piano.dispatchEvent(new win.KeyboardEvent('keydown', {key:'Delete', bubbles:true, cancelable:true}));
  check('Delete in note editor cannot remove the arranger clip', doc.querySelectorAll('.arranger-clip').length === 1 && !!doc.querySelector('.pr-body'));
  doc.querySelector('#studio-rack').click();
  rackPanel.focus();
  rackPanel.dispatchEvent(new win.KeyboardEvent('keydown', {key:'d', bubbles:true, cancelable:true}));
  check('hidden arranger cannot duplicate clips from rack keyboard input', doc.querySelectorAll('.arranger-clip').length === 1);
  doc.querySelector('#studio-arrange').click();
  for (const width of [1366, 1920, 683, 390]) {
    frame.style.width = width + 'px';
    await wait(50);
    check('workspace contains page width at ' + width + 'px', doc.documentElement.scrollWidth <= doc.documentElement.clientWidth + 1);
    check('arranger starts in the first viewport at ' + width + 'px', doc.querySelector('#arranger').getBoundingClientRect().top < 600);
  }
  check('guide link and save error status are discoverable', !!doc.querySelector('a[href="docs/USER_GUIDE.md"]') && !!doc.querySelector('#saveStatus[role="status"]'));
  doc.querySelector('#recRecord').click();
  await wait(100);
  check('Pause stays disabled during MIDI recording after transport ticks', doc.querySelector('#recRecord').classList.contains('on') && doc.querySelector('#studioPause').disabled);
  doc.querySelector('#recCancel').click();
}
check('no uncaught bootstrap or interaction errors: ' + errors.join('; '), errors.length === 0);
frame.remove();
document.getElementById('summary').textContent = `${passed} passed, ${failed} failed`;
