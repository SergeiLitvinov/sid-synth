// Workspace composition only: move live panels, never recreate their engines.
// Panels own musical actions; this module owns navigation and presentation.
export function createWorkspace({ root, transport, engine, onLayout }) {
  const doc = root.ownerDocument;
  const make = (tag, cls, text) => {
    const el = doc.createElement(tag);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    return el;
  };
  // Keep references while panels temporarily live in detached containers.
  const elements = new Map([...root.querySelectorAll('[id]')].map(el => [el.id, el]));
  const get = id => elements.get(id) || doc.getElementById(id);
  const move = (target, ...nodes) => nodes.filter(Boolean).forEach(n => target.append(n));
  root.classList.add('studio');
  const header = make('header', 'studio-header');
  const brand = make('div', 'studio-brand', 'SID');
  brand.append(make('span', '', 'STUDIO / 01'));
  const files = make('nav', 'studio-files'); files.setAttribute('aria-label', 'Проект');
  move(files, get('projNew'), get('projOpen'), get('projSave'), get('projSaveAs'), get('projFile'));
  const labels = { projNew: 'Новый', projOpen: 'Открыть', projSave: 'Сохранить', projSaveAs: 'Сохранить как',
    recRecord: '● MIDI REC', recPlay: '▶ Play', recStop: '■ Stop', recExport: 'WAV · 4 такта' };
  Object.entries(labels).forEach(([id, label]) => { if (get(id)) get(id).textContent = label; });
  const help = root.querySelector('a[href="docs/USER_GUIDE.md"]');
  if (help) { help.textContent = 'Руководство ↗'; help.className = 'studio-help'; }
  move(header, brand, files, help);
  const transportBar = make('section', 'studio-transport');
  transportBar.setAttribute('aria-label', 'Транспорт');
  move(transportBar, root.querySelector('.rec-transport'));
  const pause = make('button', 'rec-btn', 'Ⅱ Pause'); pause.id = 'studioPause';
  pause.type = 'button'; pause.title = 'Пауза; Play продолжает. Во время MIDI-записи используйте Stop.';
  pause.addEventListener('click', () => transport.pause());
  get('recStop').before(pause);
  const position = make('output', 'studio-position'); position.setAttribute('aria-label', 'Позиция в тактах и долях');
  transportBar.prepend(position);
  const updatePosition = s => {
    const ticks = s.loopPosTicks || 0, ppq = transport.ppq || 480;
    position.textContent = String(Math.floor(ticks / (ppq * 4)) + 1).padStart(3, '0') + ' : ' + (Math.floor(ticks / ppq) % 4 + 1);
    pause.disabled = !s.playing || s.recording;
    pause.setAttribute('aria-pressed', String(!!s.paused));
  };
  const unsubState = transport.onStateChange(updatePosition);
  // Tick notifications omit recording/paused flags; use the complete state.
  const unsubTick = transport.onTick(() => updatePosition(transport.getState()));
  updatePosition(transport.getState());
  const status = make('div', 'studio-status');
  move(status, get('saveStatus'));
  const inputTarget = make('span', 'studio-input-target'); status.append(inputTarget);
  const refreshTarget = () => {
    const tracks = engine.getTracks();
    const armed = tracks.filter(t => engine.isArmed(t.id));
    const active = tracks.find(t => t.id === engine.activeTrackId);
    inputTarget.textContent = 'MIDI REC → ' + (armed.length ? armed.map(t => t.name).join(', ') : active?.name || 'выберите дорожку') + ' · 4/4';
  };
  refreshTarget();

  function tabs(items, label, cls) {
    const nav = make('div', 'studio-tabs ' + cls); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', label);
    const buttons = items.map(([id, title, panel]) => {
      panel.id ||= id + '-panel'; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', id);
      const b = make('button', '', title); b.id = id; b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', panel.id);
      b.addEventListener('click', () => select(id)); nav.append(b); return b;
    });
    function select(id, focus = false) {
      items.forEach(([key, , panel], i) => {
        const active = key === id;
        panel.hidden = !active; buttons[i].setAttribute('aria-selected', String(active)); buttons[i].tabIndex = active ? 0 : -1;
        if (active && focus) buttons[i].focus();
      });
      // Existing canvas/layout controllers already listen to resize.
      window.dispatchEvent(new Event('resize'));
      if (nav.isConnected) onLayout?.();
      refreshTarget();
    }
    nav.addEventListener('keydown', e => {
      const index = buttons.indexOf(doc.activeElement);
      if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
      select(items[next][0], true);
    });
    select(items[0][0]); return { nav, select };
  }
  const arrangement = make('main', 'studio-arrangement');
  const center = make('div', 'studio-center');
  const arranger = get('arranger'); arranger.setAttribute('aria-label', 'Аранжировка');
  const dock = make('section', 'studio-dock');
  const keyboard = make('section', 'studio-keyboard');
  move(keyboard, root.querySelector('.screen'), get('keyboard'));
  const editorTabs = tabs([['studio-tracks', 'Дорожки · шаги', get('recorder')], ['studio-notes', 'Ноты · аудиоклип', get('pianoRoll')], ['studio-keys', 'Клавиатура · анализ', keyboard]], 'Редакторы', '');
  move(dock, editorTabs.nav, get('recorder'), get('pianoRoll'), keyboard);
  const sizeLabel = make('label', 'studio-dock-size', 'Высота');
  const size = make('input'); size.type = 'range'; size.min = '220'; size.max = '600'; size.value = '300'; size.setAttribute('aria-label', 'Высота редактора');
  size.addEventListener('input', () => root.style.setProperty('--dock-height', size.value + 'px'));
  sizeLabel.append(size); editorTabs.nav.append(sizeLabel);
  move(center, arranger, dock);
  const side = make('aside', 'studio-sidebar');
  const sideTabs = tabs([['studio-library', 'Аудиофайлы', get('mediaPool')], ['studio-input', 'Запись аудио', get('audioInput')]], 'Браузер и вход', '');
  move(side, sideTabs.nav, get('mediaPool'), get('audioInput'));
  const midi = make('div', 'studio-midi'); move(midi, get('midiConnect'), get('midiStatus')); side.append(midi);
  move(arrangement, center, side);
  const rackView = make('main', 'studio-rack-view');
  move(rackView, root.querySelector('.preset-panel'), root.querySelector('.workspace'));
  const views = tabs([['studio-arrange', '01 / Аранжировка', arrangement], ['studio-rack', '02 / SID Rack', rackView]], 'Рабочая область', 'studio-view-tabs');
  const oldHeader = root.querySelector('.header'); oldHeader?.remove();
  // Any empty legacy wrappers contain no controls after the moves above.
  [...root.children].filter(el => !el.textContent.trim() && !el.children.length).forEach(el => el.remove());
  root.replaceChildren(header, transportBar, status, views.nav, arrangement, rackView);
  const scopedPanels = [arranger, get('pianoRoll'), get('recorder'), keyboard, rackView];
  scopedPanels.forEach(panel => { panel.dataset.shortcutScope = ''; panel.tabIndex = -1; });
  const focusEditor = event => {
    if (event.target.closest('input, select, textarea, button, a, summary, [contenteditable="true"]')) return;
    event.target.closest('[data-shortcut-scope]')?.focus({ preventScroll: true });
  };
  root.addEventListener('pointerdown', focusEditor, true);
  let selectionKey = null;
  return {
    refreshTarget,
    showSelection(s) {
      const key = s ? s.trackId + ':' + s.clipId : null;
      if (key && key !== selectionKey) editorTabs.select('studio-notes');
      selectionKey = key; refreshTarget();
    },
    dispose() { unsubState?.(); unsubTick?.(); root.removeEventListener('pointerdown', focusEditor, true); },
  };
}
