# SID Synth — Development TODO

Статус-план разработки. `[x]` — сделано, `[ ]` — не начато.

## P0 — Восстановление работоспособности (критично)

- [x] Вернуть `savePatch()` / `loadPatch()` (функции потеряны при рефакторинге; без них `main.js` падает на `ReferenceError` → осциллоскоп/спектроскоп/MIDI не работают)
- [x] Обработчики `savePreset` / `loadPreset` / `deletePreset` / `presetList` (localStorage) — кнопки в `index.html` мёртвые
- [x] Удалить `src/main.js.bak` / `src/main.js.old`, добавить паттерны бэкапов в `.gitignore`

## P1 — Архитектура

- [x] Уникальные `id` компонентов (`type_N` на счётчике) — повторный drag OSC1 больше не перезаписывает существующий; метка OSC сохраняется при save/load через `params.n`
- [x] Утечки слушателей: `makeDraggable` и `Knob` переведены на pointer-capture (`setPointerCapture`) — слушатели умирают вместе с элементом
- [x] `playNote`/`setFrequency`: смена ноты идёт через `osc.frequency.setValueAtTime`, нода пересоздаётся только при смене waveform — убраны щелчки
- [x] Клавиатура: `activeNotes` (Set) — отпускание одной зажатой клавиши не глушит остальные (mono last-note ретриггер)
- [ ] Полифония классического модульного рэка: `activeNotes` сейчас решает только mono last-note gate; полноценная аллокация голосов и per-voice ADSR есть лишь в рекордере (`TrackVoices`)
- [x] Splitter: маршрутизация каналов (индексы) в `drawConnections` / `addConnection` (`outChannel` в `connections`, `data-channel` на портах)
- [x] LFO: модуляция `AudioParam` — соединение `lfo → target` помечается `mod:true`, подключается к `getModParam()` (частота OSC / cutoff фильтра), кабель рисуется розовым; у осциллятора появился вход (mod/aux)
- [x] Секвенсор: ноты с октавами + lookahead-шейдулинг по `ctx.currentTime` (`PatternSequencer._schedule`, `scheduleNote` в main.js)

## P2 — Качество

- [x] ~~`package.json`, eslint + prettier~~ — ОТМЕНЕНО по решению пользователя: без внешних зависимостей, без Node (браузерные тесты + `serve.py` на python)
- [x] Декомпозиция `main.js` (973 → 377 строк): `src/services/*` — `router.js` (соединения/порты/клавиши Escape-Del), `notes.js`, `presets.js`, `componentParams.js`, `keyboard.js`, `midi.js`, `visualization.js`, `patchStore.js`, `patchFile.js`; регрессия: E2E-тест `tests/integration.js` 21/21
- [x] `src/components/index.js` — экспорт всех компонентов (+ Knob)
- [x] Починить CSS: убран дубль `.component-header`, невалидные hex `#4af7430`/`#4af7433`/`#4af7422` → `#4af743`/`#4af742`
- [x] Обновить README (актуальная структура: `modulator/`, `sequencer/`, `lp/hp/bp`, `nonlinear`; фичи LFO-модуляции, splitter, seq)
- [x] Тесты — только браузерные, без Node: `tests/smoke.html/js` (реальный AudioContext, 10/10), `tests/mock-test.html/js` (unit-эквивалент на `tests/mockAudioContext.js`, 11/11). Запуск: `serve.py` + открыть страницу/Playwright
- [x] E2E-тест: `tests/integration.js` (21 шаг: рэк, 5 кабелей, mod-кабель, клавиатура, пресеты в UI, save/load round-trip, удаление кабеля, localStorage) гоняется браузерным харнессом (Playwright MCP) против живого приложения `http://127.0.0.1:3000` — без FAIL
- [x] Пресеты обновляют UI параметров: применение через `applyParams` (вместо прямых мутаций аудио-ядра) — встроенный `bass` показывает `sawtooth` + `110Hz` в селекте/ноббе
- [x] Пользовательские пресеты: сохранение позиций и соединений (по индексам компонентов, `savePreset`/`loadPreset` в `patchStore.js`) — round-trip восстанавливает рэк, провода и mod-кабель (было «немым»); заодно чинен дрейф позиций при save/load патча (`loadPatch` ставит координаты напрямую) и синхронизация чекбокса OSC в `applyParams`
- [x] Регрессия соединений мышью: `makeDraggable` (pointerdown + setPointerCapture + preventDefault) проглатывал `click` по портам `.conn-point` — в guard добавлено исключение портов; проверено настоящими trusted-кликами (Playwright `page.mouse.click`) + шаг в E2E
- [x] Автосейв рэка: `src/services/autosave.js` — debounced (600мс) снапшот компонентов/позиций/соединений в localStorage через MutationObserver (childList+subtree+attributes) + `change`-события; авто-восстановление при загрузке страницы (в backlog п.6 заменён на единый `projectStore`/`sidSynthProject`, файл удалён)
- [x] Встроенные пресеты применяются ко ВСЕМ компонентам типа (все осцилляторы/фильтры/ADSR), а не к первому; `findComponentByType` удалён
- [x] Отмена взятия порта кликом по пустому месту рэка (раньше только Escape); заодно клик по пустому рэку снимает выделение кабеля
- [x] Dev-сервер: `serve.py` отдаёт `Cache-Control: no-store` (вместо `python -m http.server`); `serve.ps1` переключён на него

## P3 — Мультитрековый рекордер

- [x] `src/tracks/voiceEngine.js` — независимый голосовой тракт на трек (osc→filter→env→trackGain→dest), 8 голосов с per-voice ADSR; перекрывающиеся ноты не ретриггерят общий ASDR (полифония в рамках трека)
- [x] `src/tracks/trackEngine.js` — мультитрековый луп-шедулер (16 шагов, 4/4, sixteenths): сетка + реальное время (rt), транспорт REC/PLAY/STOP, lookahead-шедулинг по `ctx.currentTime`, автозахват активного трека при REC, BPM
- [x] `src/tracks/recorderUI.js` — панель RECORDER: транспорт, BPM, добавление/удаление треков, ARM, выбор волны/фильтра, грид-редактор 16 шагов, индикатор записанной ноты
- [x] Клавиатура → рекордер: хуки `onNoteOn/onNoteOff` в `createKeyboard`; live-мониторинг + запись rt-нот в armed-треки
- [x] Персистенция треков в `localStorage` (`sidSynthTracks`), автосохранение раз в 3с
- [x] Тесты: `tests/track-test.html/js` (14 проверок: конфиг трека, BPM/stepDur, grid toggle, scheduling на Web Audio clock, монотонность шагов, захват noteOn/noteOff, автозахват, held-note commit, воспроизведение rt-нот, loop wrap, updateTrack, clearTrack, removeTrack, getState) на `mockAudioContext`
- [x] E2E: `tests/integration.js` расширен до 28 шагов (панель рекордера, ADD трека, грид-селл, транспорт, захват ноты с клавиатуры, BPM) — прогон: 28/28 PASS
- [x] Фикс коллизии id треков: `_idCount` двигался только при генерации id, поэтому дефолтный трек `id:'trk_1'` не поднимал счётчик и первый ADD создавал второй `trk_1` → клик по грид-селлу первого трека переключал шаги второго (E2E шаг 15 падал). Теперь `addTrack` поднимает `_idCount` от явных id; проверено уникальностью `trk_1/trk_2`
- [x] AudioContext без пользовательского жеста: осцилляторы стартуют лениво (первая нота/транспорт, `_ensureStarted`), `play/noteOn/noteOff` вызывают `ctx.resume()` — ушли 8 предупреждений «AudioContext was not allowed to start»
- [x] README: фичи рекордера, структура `src/tracks/`, счётчики тестов
- [x] Python-free dev-сервер `tests/serve-ps.ps1` (PS7 HttpListener, порт 3100, `Cache-Control: no-store`) — для машин без Python/Node; задокументирован в README/CODING_STANDARDS
- [x] Пользовательские ноты в гриде: ячейка сетки хранит `{ note, dur }` (высота + длительность в шестнадцатых, дефолт из `track.gridDur`). Клик по селлу включает его и выделяет; поля «Selected step note» / «Selected step length» в строке трека редактируют именно эту ноту; без выделения те же поля задают дефолты трека (`setGridStep`/`setGridDur`/`setGridNote`). Легаси-строковые ячейки нормализуются при чтении — старые сохранённые треки работают
- [x] Тесты per-note: `track-test` расширен с 14 до 18 проверок (пер-ячейковая длительность/высота, normalize legacy, воспроизведение с per-cell dur); E2E расширен с 28 до 34 шагов (выбор селла, правка высоты/длительности выбранной ноты, нетронутые дефолты других треков, дефолтная длительность трека применяется к новым нотам) — прогон: 34/34 PASS

- [x] Undo/redo в рекордере: все правки (ADD/DEL/CLR, wave/filter, note/dur, грид) гоняются через command history (`src/project/history.js` + `trackCommands.js`). Кнопки ↶/↷, шорткаты Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z. E2E расширен с 34 до 39 шагов (undo/redo грид-правки, undo после DEL трека) — прогон: 39/39 PASS

---

# Путь к полноценной web-DAW

Ниже — целевая дорожная карта уровня Reaper / Pro Tools / Reason / Cakewalk / Ardour. Это не обещание полного паритета с ними в одной версии: сначала нужен надёжный DAW-фундамент, затем редакторы, микшер и профессиональные функции. SID остаётся основной звуковой и визуальной идентичностью продукта, а модульный рэк — встроенным инструментом DAW, а не отдельным приложением.

## Аудит текущего состояния (2026-08-13)

### Уже является хорошей основой

- [x] Web Audio-граф модульного рэка: генераторы, фильтры, ADSR, LFO, delay/reverb, mixer/splitter и визуальные patch-cables.
- [x] Lookahead scheduling по `AudioContext.currentTime` в секвенсоре и рекордере.
- [x] Восьмиголосная полифония синт-треков через `TrackVoices`.
- [x] 16-шаговый луп, realtime MIDI-note capture, arm и базовый транспорт.
- [x] Импорт/экспорт патча, пресеты, autosave, MIDI input и браузерные тесты.
- [x] Versioned project document (`src/project/`): `schemaVersion`, default project, serialize/parse, `migrateProject`, `fromLegacy` из старых localStorage-ключей; round-trip tests (`tests/project-test.html/js`, 20/20) и `docs/PROJECT_SCHEMA.md`.
- [x] SID/rack UI — уже сформированная стилистическая база продукта.

### Чего пока нет для статуса DAW

- [x] Единой модели проекта: рэк, треки и настройки сохраняются в один versioned snapshot (`src/project/projectStore.js`, ключ `sidSynthProject`, миграция старых ключей). Ещё нет: один project file, UI layout в документе.
- [~] Линейного arranger timeline: есть минимальный arranger canvas (ruler, playhead, track lanes, zoom/scroll) и отображение MIDI-клипов (`clips[]`, layoutClips, loop-клип несёт grid/rt ноты и показывает их мини-нотами); но engine всё ещё воспроизводит один 16-step loop и не знает clips/regions/markers.
- [ ] Audio tracks: нет записи с микрофона/line-in, импорта/декодирования файлов, waveform peaks, обрезки и playback аудиоклипов.
- [ ] Полноценного MIDI editor/piano roll: нет произвольной длины нот, velocity, каналов, CC, pitch bend, aftertouch, quantize/humanize.
- [ ] DAW mixer: track/bus/master strips, pan, mute, solo, sends/returns, pre/post-fader, meters и routing graph отсутствуют.
- [ ] Automation lanes и sample-accurate automation параметров.
- [ ] Undo/redo, command history, selection model, clipboard и недеструктивных edit operations.
- [ ] Надёжного хранения больших проектов: `localStorage` не подходит для аудиоданных и больших сессий; нужен IndexedDB/OPFS.
- [ ] Offline render/export WAV, stems, mixdown, freeze/flatten и bounce in place.
- [ ] Управления latency, input monitoring, count-in, metronome, punch in/out и компенсации задержки.
- [ ] Производительного UI для длинных проектов: виртуализация, zoom/scroll, worker-generated peaks, управление ресурсами.
- [ ] Плагинной модели. Нативные VST/VST3/AU из браузера напрямую недоступны; реалистичная web-цель — встроенные модули, AudioWorklet/WASM DSP и, отдельно, Web MIDI/внешние bridge-решения.

### Технический долг, который блокирует масштабирование

- [ ] Разделить состояние, audio engine и DOM: сейчас `main.js`, `recorderUI.js` и router напрямую связывают UI с живыми AudioNode.
- [ ] Убрать два независимых транспорта (`PatternSequencer` и `trackEngine`) в пользу одного clock/transport service.
- [ ] Заменить фиксированные `STEPS_PER_LOOP = 16` и `NOTE_BEATS = 4` на tempo map, time signature и позицию в ticks/PPQ.
- [ ] Сделать единый track engine для instrument/audio/bus/master вместо отдельного `TrackVoices`, напрямую подключённого к `masterGain`.
- [ ] Версионировать сериализацию; связи хранить по стабильным UUID, а не по индексам компонентов.
- [ ] Исправить lifecycle: централизованно освобождать интервалы, observers, MIDI handlers и AudioNode при закрытии/перезагрузке проекта.
- [ ] Привести `main.js` к цели `<300` строк и убрать оставшийся `console.log` загрузки.
- [ ] Устранить нарушение standards в `recorderUI.js`: там используется большой `innerHTML`, хотя документация требует `document.createElement`.
- [ ] Расширить mock Web Audio API для AudioBufferSource, MediaStream, StereoPanner, AudioWorklet и OfflineAudioContext.

## Принципы целевой архитектуры

- [ ] **Один источник правды:** serializable `ProjectState`; UI отправляет commands, engine наблюдает изменения, persistence сохраняет snapshots.
- [ ] **Один транспорт:** время проекта хранится музыкально (PPQ ticks), при планировании переводится в секунды с учётом tempo map.
- [ ] **Недеструктивность:** clip хранит ссылку на source asset плюс offset/gain/fades/warp; исходное аудио не переписывается.
- [ ] **Разделение control/audio thread:** тяжёлые DSP — AudioWorklet/WASM, peaks/import/render — Worker, DOM — main thread.
- [ ] **Routing как данные:** `sourceId`, `destinationId`, channels, gain, pan, pre/post; AudioNode-граф является производной моделью.
- [ ] **Версионирование:** каждый project/preset/asset manifest содержит `schemaVersion`; миграции тестируются fixture-файлами.
- [ ] **Progressive enhancement:** базовое редактирование работает без MIDI и OPFS; неподдерживаемые browser API показывают понятную диагностику.
- [ ] **SID-first, DAW-capable:** ограничения SID (3 voices, chip models, registers) доступны как осознанный режим, но движок не ограничивает обычные instrument/audio tracks.

## M0 — Зафиксировать продукт и контракты (P0)

- [ ] Описать пользовательские сценарии v1: создать проект → записать MIDI/audio → собрать arrangement → свести → экспортировать WAV.
- [ ] Зафиксировать минимальный DAW v1: linear timeline, instrument/audio tracks, piano roll, mixer, automation, project save/load и mixdown.
- [ ] Определить browser support matrix (Chromium/Firefox/Safari) и fallback для Web MIDI, OPFS, AudioWorklet и input recording.
- [ ] Принять единицы времени: PPQ 960 ticks/quarter, seconds только на границе audio scheduler; определить правила округления.
- [ ] Описать `ProjectState` JSON Schema и entity IDs: project, track, clip, event, device, route, automation lane, asset.
- [ ] Записать ADR: framework/no-framework, state store, immutable commands, worker protocol, DSP/WASM policy.
- [ ] Завести feature matrix «SID Synth сейчас / DAW v1 / после v1», чтобы не смешивать MVP и дальние функции.

**Критерий выхода:** пустой versioned project проходит create → serialize → load → migrate → identical state.

## M1 — DAW core: project, commands, transport (P0)

### Project model и history

- [ ] `src/project/`: `ProjectState`, schema validation, migrations, stable UUID и default project factory.
- [ ] Объединить rack patch, recorder tracks, tempo и UI layout в один документ проекта.
- [ ] Command bus: `execute`, `undo`, `redo`, transaction/batch и dirty flag; все пользовательские правки проходят через commands.
- [ ] Selection model для tracks/clips/events/range; clipboard с внутренним MIME/version.
- [ ] Autosave journal + периодические snapshots; recovery dialog после аварийного закрытия.
- [ ] Не записывать transient UI/audio-node поля в project state.

### Transport и musical time

- [ ] Единый `Transport`: play, pause, stop, seek, record, loop range, current tick, preroll/postroll.
- [ ] Tempo map с несколькими tempo events и time signatures; bar/beat/tick formatter.
- [ ] Metronome с accent, count-in 1–4 bars, отдельным уровнем и маршрутом.
- [ ] Scheduler с lookahead horizon, seek/cancel/reschedule и защитой от duplicate events.
- [ ] Loop playback без двойных note-on на границе; корректные chase notes/automation после seek.
- [ ] Clock diagnostics: late events, scheduling jitter, AudioContext state и output latency (где API доступно).

**Критерий выхода:** один транспорт синхронно ведёт старый step recorder и modular sequencer, seek/loop/tempo change покрыты deterministic tests.

## M2 — Arranger и базовый song workflow (P0, DAW MVP)

- [ ] Новый основной layout: top transport, слева track headers, центр timeline, снизу docked editor, справа inspector/browser; rack открывается вкладкой устройства.
- [~] Ruler bars/beats, playhead, grid, snap, horizontal/vertical zoom и scroll (реализовано: ruler по барам, playhead, track lanes, horizontal zoom/scroll; нет grid/snap/vertical zoom).
- [ ] Track types: instrument, audio, group/bus, return и master.
- [~] Clip model: `clips[]` на треке (start/length/name/color в PPQ-тиках, `events` — ноты в тиках), отображение нескольких клипов в arranger, `addClip/removeClip` + undo/redo; loop-клип (start 0) несёт grid/rt ноты трека и рендерит их мини-нотами внутри клипа. Ещё нет: редактирование позиции/длины мышью, source offset, loop, mute, gain, fades.
- [~] Создание, select, move, trim, split, duplicate, loop и delete clips; multi-select и range select (реализовано в #11/#12/#13/#14/#15: select кликом, move drag'ом с snap, trim по краям (левый/правый edge), split по playhead/середине (S), duplicate (D), loop (L, повтор 3x), multi-select Ctrl+click, range select Shift+click, drag всей группы, delete нескольких — всё через undoable command history).
- [x] Track reorder, resize, rename, color, folder/collapse, mute/solo/arm/monitor (реализовано в #17/#18/#19/#20/#21/#22/#23: track headers в arranger lane с кнопками M/S, mute/solo как undoable-команды через history, engine-level audibility — muted не слышен, solo изолирует остальные; кнопки M/S в recorder; персистенция muted/solo в проекте; rename двойным кликом по имени трека в recorder и по label в arranger lane, undoable; reorder ▲/▼ в recorder rows и arranger lane headers как undoable-команды, порядок треков персистится; color через color-input в recorder row и arranger lane header как undoable-команда, персистится; monitor через MNT-кнопки в recorder row и arranger lane header как undoable-команда, персистится; resize — drag-хэндл по нижней границе lane (`.arranger-lane-resize`) как undoable-команда, высота персистится; folder/collapse — `folder` (id родителя-папки) и `collapsed` на треке, кнопка ▾/▸ в recorder row (`.rec-collapse`, прячет grid-строку трека) и в arranger lane header (`.arranger-lane-collapse`, сужает lane до 18px / прячет lane-детей свёрнутой папки), `engine.folderChildren`/`engine.visibleTracks`, undoable через `updateTrackCommand`, персистится).
- [~] Markers, loop locators и project end marker (реализовано в #16: маркеры на ruler — добавление через кнопку `+ mrk` на playhead, рендер флагов с названием, клик = `transport.seek(tick)`, удаление ×, всё undoable через command history, персистенция `project.markers` в едином снапшоте, reactive store `createMarkerStore`; transport получил `seek()`. Ещё нет: loop locators и project end marker).
- [ ] Virtualized rendering: DOM/canvas создаёт только видимый диапазон дорожек и времени.
- [ ] Keyboard shortcuts: Space, R, S, M, Ctrl/Cmd+Z, split, duplicate, zoom, delete; редактируемая keymap позже.
- [ ] Accessible focus order, tooltips и нецветовые состояния arm/mute/solo.

**Критерий выхода:** пользователь собирает песню длиннее одного loop из нескольких MIDI clips, сохраняет и после загрузки получает тот же arrangement.

## M3 — Instrument tracks и piano roll (P0, DAW MVP)

- [ ] MIDI clip/event model: note start/duration/pitch/velocity/channel и expression data.
- [ ] Piano roll: draw/select/move/resize notes, marquee, audition, velocity lane, zoom и snap.
- [ ] Quantize с strength/swing, transpose, duplicate, legato, fixed length и humanize (с preview/undo).
- [ ] Step input и realtime record в текущий clip с overdub/replace режимами.
- [ ] Record quantization отдельно от post-record quantize; исходные timestamps не терять.
- [ ] MIDI chase при старте из середины: sustained notes, CC, program state.
- [ ] MIDI input routing по device/channel, track input selector и monitor auto/on/off.
- [ ] Поддержать pitch bend, modulation, sustain pedal, channel pressure и основные CC.
- [ ] Перенести существующую 16-step grid в режим drum/step editor поверх общего MIDI event model.
- [ ] Device chain instrument track: SID instrument → inserts → fader, без прямого подключения `TrackVoices` к master.

**Критерий выхода:** полифоническая MIDI-запись и редактирование произвольной длины стабильно воспроизводятся при seek, loop и смене BPM.

## M4 — Audio tracks, recording и clips (P0, DAW MVP)

### Assets и импорт

- [ ] Asset store в IndexedDB или OPFS: binary audio отдельно от project JSON, hash/dedup и reference counting.
- [ ] Import через file picker и drag-and-drop; decode WAV/AIFF/MP3/OGG/FLAC по фактической поддержке браузера.
- [ ] Resample к sample rate проекта при необходимости; сохранять исходный файл и metadata.
- [ ] Worker-generated waveform peaks с несколькими уровнями детализации и кэшем.
- [ ] Missing media resolver: locate, relink, replace и список отсутствующих assets.

### Запись и playback

- [ ] Input devices через `getUserMedia`, выбор mono/stereo channel, permission/error UX.
- [ ] Input monitoring, input meter, gain warning и безопасная защита от feedback routing.
- [ ] MediaRecorder не использовать как единственный точный тракт: исследовать AudioWorklet PCM capture для sample-aligned записи.
- [ ] Latency calibration и placement compensation с ручным offset fallback.
- [ ] Punch in/out, count-in, takes/lane recording и loop recording takes.
- [ ] Audio clip playback через `AudioBufferSourceNode`/streaming strategy с sample-accurate start/offset/stop.
- [ ] Fades/crossfades и clip gain без изменения source asset.

**Критерий выхода:** запись микрофона создаёт синхронный аудиоклип, проект переоткрывается без потери media, edit/playback не меняют исходник.

## M5 — Mixer, routing и metering (P0, DAW MVP)

- [ ] Единая channel strip: input → device/inserts → pre-fader sends → pan → fader → post-fader sends → output.
- [ ] Track/bus/return/master strips с volume, pan, mute, solo, arm, input monitor и output selector.
- [ ] Solo modes: solo-in-place и exclusive solo; mute/solo propagation через folders/buses.
- [ ] Sends/returns pre/post-fader; sidechain-capable route schema.
- [ ] Stereo panner и channel layouts; v1 минимум mono/stereo, multichannel — после v1.
- [ ] Peak/RMS meters, clip hold/reset и master headroom; обновление meter UI не чаще animation frame.
- [ ] Master limiter как защитная опция, не скрывающая внутренний clipping.
- [ ] Routing matrix/graph с cycle detection и явной feedback policy.
- [ ] Channel strip presets и copy/paste устройств/настроек.
- [ ] Тесты gain staging: mute/solo/pan/send не создают лишних connect и не удваивают сигнал.

**Критерий выхода:** полноценный mix из instrument/audio tracks через buses и returns экспортируется так же, как звучит realtime playback.

## M6 — Devices, SID rack и DSP (P1)

- [ ] Превратить текущий modular rack в device `SID Rack`, который можно вставить на instrument track.
- [ ] Разделить patch definition и voice runtime: один патч клонируется на N голосов, modulation/routes применяются per voice или global по контракту.
- [ ] Настоящий SID mode: 3 голоса, pulse width, sync, ring modulation, noise, shared multimode filter, voice routing и master volume.
- [ ] Переключаемые модели 6581/8580 с задокументированными приближениями nonlinear filter и combined waveforms.
- [ ] UI для уже существующих PWM/ring mod/hard sync модулей; добавить wavetable/sample player позже.
- [ ] Device parameter registry: stable parameter IDs, value ranges, units, curves, defaults и automatable flag.
- [ ] Insert chain add/remove/reorder/bypass; wet/dry и latency metadata для каждого effect.
- [ ] Перенести критичный DSP в AudioWorklet; оценить WASM только после профилирования.
- [ ] Preset browser с factory/user presets, tags, search, preview и schema migration.
- [ ] Per-device mini visualizers без создания отдельного analyser на каждый скрытый device.

**Критерий выхода:** один SID Rack патч играет полифонически как устройство трека, сохраняется в project и все заявленные параметры доступны automation.

## M7 — Automation и modulation (P1)

- [ ] Automation lane model: target parameter ID, points, interpolation (step/linear; curves позже), enabled/read/write state.
- [ ] Lane UI: add/move/delete points, multi-select, draw tools, value tooltip, snap и thinning.
- [ ] Automation modes: Read, Touch, Latch, Write; write gestures группируются в одну undo transaction.
- [ ] Sample-accurate scheduling через AudioParam automation там, где возможно; control-rate fallback явно маркировать.
- [ ] Automation chase при seek/loop и корректная интерполяция в начале render range.
- [ ] Clip envelopes для gain/pan и parameter automation внутри повторяющегося клипа.
- [ ] Modulation matrix SID Rack: LFO/envelope/velocity/key tracking → parameter, depth и polarity.
- [ ] Конфликт automation/modulation/manual input описать единым правилом итогового значения.

**Критерий выхода:** записанный cutoff move одинаково воспроизводится realtime и offline, включая seek и loop boundary.

## M8 — Editing depth и production workflow (P1)

- [ ] Tool modes: pointer, range, draw, erase, split, stretch; временные modifier shortcuts.
- [ ] Ripple edit off/per-track/all, slip edit, nudge и configurable snap/grid.
- [ ] Comping: take lanes, promote ranges, crossfades и flatten comp.
- [ ] Audio time-stretch/pitch-shift — отдельный исследовательский этап; сначала offline algorithm, затем realtime preview.
- [ ] Transients и warp markers после появления стабильного stretch engine.
- [ ] Track freeze/unfreeze, bounce in place, consolidate и render selection.
- [ ] Project templates, track templates, import tracks from project.
- [ ] Notes/comments на tracks/clips/markers и session metadata.
- [ ] Workspace/screensets и detachable/docked panels в рамках возможностей браузера.

## M9 — Export, interchange и backups (P0 для релиза v1)

- [ ] OfflineAudioContext render: full mix, selection и loop range.
- [ ] WAV export PCM 16/24/32-float с sample rate selector; dithering для integer bit depth.
- [ ] Stem export по tracks/buses, tail handling для reverb/delay и нормализованные безопасные имена файлов.
- [ ] Export progress/cancel и memory budget; длинные проекты рендерить chunks, если browser limits требуют.
- [ ] MIDI file import/export (SMF type 0/1), tempo/time signatures и channel mapping.
- [ ] Project bundle manifest + assets; validate hashes при import и не исполнять данные из проекта.
- [ ] Rolling backups с retention policy и ручной `Save As`.
- [ ] Crash recovery и диагностика повреждённого проекта без уничтожения последнего рабочего snapshot.
- [ ] Позже: AAF/OMF/ADM считать отдельными большими проектами, не частью web-DAW v1.

**Критерий выхода:** mixdown и stems воспроизводятся вне приложения, а перенесённый project bundle открывается на другом устройстве без silent missing data.

## M10 — Performance, reliability и testing (идёт параллельно)

- [ ] Performance budgets: CPU/audio glitches, memory, initial load, scroll FPS, max tracks/clips/voices для reference machine.
- [ ] AudioWorklet underrun/glitch telemetry только локально и без записи пользовательского аудио.
- [ ] Удаление/замена clip/device/track гарантированно отменяет будущие scheduled events и освобождает nodes/buffers.
- [ ] Lazy decode/eviction audio buffers; не держать весь длинный project одновременно в RAM.
- [ ] Worker protocol с transferable buffers и cancellation; никаких больших waveform arrays через повторный structured clone.
- [ ] Unit tests: musical time, tempo map, commands, migrations, scheduling, routing, automation interpolation.
- [ ] Integration tests: record → edit → save → reload → render; deterministic fake clock.
- [ ] Golden audio tests: render коротких fixtures и сравнение с допуском, а не побитовое для всех браузеров.
- [ ] E2E: основные journeys, keyboard shortcuts, drag edits, recovery, missing media и permission denial.
- [ ] Cross-browser CI минимум Chromium/Firefox; Safari — регулярный ручной прогон или доступная CI-инфраструктура.
- [ ] Stress projects: 50+ tracks, 10k clips/events, длинное audio, частые tempo changes.
- [ ] Accessibility tests, reduced motion, high contrast и keyboard-only editing.

## M11 — UX и SID-визуальный язык (P1)

- [ ] Сохранить зелёный phosphor/CRT характер, но ввести токены цветов, размеров, spacing и состояний.
- [ ] Развести декоративный glow и рабочую читаемость; обеспечить контраст текста, grid и automation curves.
- [ ] Density modes: compact для mixer/arranger и comfortable для touch; минимальные hit targets.
- [ ] Иконки и состояния транспорта не должны полагаться только на цвет.
- [ ] Масштабирование интерфейса 75–200%, responsive minimum viewport и fullscreen mode.
- [ ] Context menus, inspector и status bar с подсказкой текущего инструмента/modifiers.
- [ ] Browser/media/preset panel в стиле cartridge/disk library; rack cables остаются главным визуальным мотивом устройства.
- [ ] Onboarding project и встроенный tutorial без блокировки опытного workflow.
- [ ] Локализация RU/EN: строки вне компонентов, формат чисел/времени отдельно от внутренних данных.

## M12 — После устойчивого DAW v1 (P2)

- [ ] Control surface mapping, MIDI learn, Mackie Control/HUI — если browser/bridge обеспечивает нужные порты.
- [ ] MPE и per-note expression.
- [ ] Video track/timecode, SMPTE ruler и spotting workflow.
- [ ] Surround/multichannel и advanced panner.
- [ ] Script/macro actions в sandboxed API; action list в духе Reaper.
- [ ] WebRTC collaboration: сначала обмен project bundle, затем comments/versioning, только потом realtime co-edit.
- [ ] Cloud sync — opt-in, с конфликтами версий и end-to-end privacy design до реализации.
- [ ] PWA/offline install и storage persistence request; предупреждение перед browser eviction.
- [ ] Community device SDK на AudioWorklet/WASM с capability permissions и versioned API.
- [ ] Desktop wrapper/companion bridge только как отдельный продуктовый выбор для filesystem, low-latency drivers и native plugins.

## Предлагаемый порядок релизов

| Релиз | Состав | Пользовательский результат |
|---|---|---|
| **0.4 Core** | M0–M1 | Единый проект, undo/redo и транспорт вместо разрозненных loop-систем |
| **0.5 Arrange** | M2–M3 | Полная песня из MIDI-клипов на линейном timeline |
| **0.6 Audio** | M4 | Импорт, waveform, запись и недеструктивное редактирование аудио |
| **0.7 Mix** | M5 + часть M7 | Mixer, buses, sends, meters и базовая automation |
| **0.8 SID Studio** | M6 | Полноценный SID Rack как полифонический DAW instrument/device |
| **0.9 Production** | M8–M9 | Freeze/bounce, backups, WAV/stems/MIDI export и переносимые проекты |
| **1.0** | M10–M11, стабилизация | Проверенный cross-browser workflow record → arrange → mix → export |

## Ближайший практический backlog (следующие 10 задач)

1. [x] Создать `docs/PROJECT_SCHEMA.md` с сущностями и примером minimal project JSON.
2. [x] Ввести `src/project/defaultProject.js`, `serialize.js`, `migrate.js` и round-trip tests.
3. [x] Реализовать command history и перевести add/remove/update track на commands: `src/project/history.js` (execute/undo/redo, dirty flag, markSaved/reset, onChange) + `src/project/trackCommands.js` (add/remove/update/clear/toggleGrid/setGridStep). UI рекордера гоняет правки через history: кнопки ↶/↷, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z; undo/redo откатывает ADD/DEL/CLR/wave/filter/note/dur/grid. Тесты: `tests/history-test.html/js` (18/18) и `tests/recorderUI-test.html/js` (8/8, клики по реальным кнопкам через history).
4. [x] Сделать `MusicalTime`/`TempoMap` с PPQ и unit tests на tempo/time-signature changes: `src/project/musicalTime.js` (PPQ=480, bar/beat/tick ↔ ticks) и `src/project/tempoMap.js` (ordered tempo + signature events, `ticksToSeconds`/`secondsToTicks` walking tempo changes, `musicalTimeToTicks`/`ticksToMusicalTime` walking bar lengths по сигнатурам). Тесты: `tests/musicalTime-test.html/js` (26/26).
5. [x] Реализовать единый `Transport` и адаптер для существующего 16-step engine: `src/project/transport.js` (PPQ-часы, lookahead-timer, позиция в ticks через TempoMap, play/record/stop, подключаемые schedulers) + `src/tracks/stepEngineAdapter.js` (часы/таймер/позиция двигаются Transport'ом, движок сохраняет голоса и внутренний планировщик; `engine.bpm` синхронизирован с темп-картой). Подключено в `src/main.js`. Тесты: `tests/transport-test.html/js` (22/22, включая адаптер: грид-ноты на аудио-клоке, loop wrap, record capture, stop-reset). Все 8 наборов зелёные, E2E 39/39 против живого приложения.
6. [x] Перевести сохранение rack+tracks на один versioned project snapshot, оставив миграцию старых localStorage keys: `src/project/projectStore.js` — `createProjectStore` пишет весь снимок (rack + tracks + tempo + activeTrackId) в единый ключ `sidSynthProject` (debounce 600мс, `saveNow`/`save`/`markDirty`), `restore()` читает новый ключ, а при его отсутствии мигрирует старые ключи (`sidSynthAutosave` → rack, `sidSynthTracks` → tracks/tempo) через `fromLegacy`, пишет мигрированный документ обратно и удаляет legacy-ключи. В `main.js` заменены `saveTracks`-интервал и `autosave.js` (удалён): триггеры — MutationObserver на рэке, `change`-событие, `history.subscribe` (в `history.js` добавлена мульти-подписка) и safety-interval 3с; `captureProject`/`applyProject` строят документ через `serializeProject` и восстанавливают рэк + треки + темп. `recorderUI.renderAll` теперь отражает восстановленный BPM в поле ввода. Тесты: `tests/projectStore-test.html/js` (11/11: save/restore, миграция legacy, приоритет нового ключа, debounce, clear) + `tests/history-test.html/js` расширен до 20/20 (subscribe). Все 9 наборов зелёные (146/146), E2E 39/39, миграция проверена live (legacy → `sidSynthProject`).
7. [x] Добавить минимальный arranger canvas: `src/arranger/arrangerLayout.js` (pure-геометрия: ticks↔px, ruler по барам, layout блоков паттерна) + `src/arranger/arranger.js` (createArranger: toolbar zoom −/+, ruler, lane-строки с блоками 16-step паттерна, playhead; подписки transport.onTick/onStop и history.subscribe; ctrl+wheel zoom; pxPerQuarter=48, bars=8, laneHeight=26, rulerHeight=20). Для этого `src/project/transport.js` переведён на мульти-слушатели (массивы + emit), чтобы stepEngineAdapter и arranger сосуществовали. Панель `#arranger` в `index.html` + стили `.arranger-*` в `style.css`, подключено в `src/main.js` (render при старте, applyProject, restore). Тесты: `tests/arranger-test.html/js` (24/24: xToTicks/ticksToX, ruler, layout блоков, DOM lanes/blocks/playhead/zoom). Все 10 наборов зелёные (170/170), E2E расширен с 39 до 44 шагов (секция 24: arranger).
8. [x] Ввести MIDI clip model и отображение нескольких clips на timeline: `defaultClip` (id/name/color/start/length в PPQ-тиках, `events: []` — наполняется в #9) + `clips[]` на треке (`defaultProject.js`, `defaultTrackConfig` в `trackEngine.js`). `trackEngine.addClip/removeClip`, `getTracks`/`updateTrack` включают clips; нормализация в `serialize.js` (`normalizeClip`, `normalizeTrackData`) и `migrate.js`. Arranger: `layoutClips` (pure-геометрия clip → x/width), lane с clips рендерит их (вместо pattern-блоков), кнопка `+ clip` в тулбаре добавляет клип в активный трек на свободную позицию через command history (`addClipCommand`/`removeClipCommand` в `trackCommands.js`, undo/redo работают). Тесты: `arranger-test` расширен до 32/32 (layoutClips, DOM-клипы, addClipCommand через history), `project-test` до 22/22 (round-trip клипов, normalize частичных полей). Все 10 наборов зелёные (180/180), E2E расширен с 44 до 47 шагов (секция 25: clip-кнопка, клип на lane активного трека, undo) — прогон 47/47 PASS.
9. [x] Перенести grid notes/realtime events из track root внутрь MIDI clip: `src/project/clipEvents.js` — чистые конверсии grid/rt ↔ clip events в PPQ-тиках (`gridToClipEvents`, `rtToClipEvents`, `mergeClipEvents`, `clipEventsToGrid`, `clipEventsToRt`; шестнадцатая = ppq/4, реальное время через bpm). `trackEngine` (`engine.ppq`): loop-клип (clips[0], start 0) — канонический нотный контейнер — зеркалит grid+rt в `events` при каждой мутации (toggle/set/clear/commit) и в `getTracks()`; трек, восстановленный из clip-first документа (events в клипе, пустые grid/rt), разворачивается обратно в grid/rt для шагового движка. Arranger: `layoutClipNotes` (мини-ноты внутри клипа) + рендер `.arranger-clip-note` в блоке клипа. Тесты: новый `clipEvents-test` (17/17) + `track-test` до 28/28 (10 проверок loop-клипа/синка/восстановления) + `arranger-test` до 40/40 (8: layoutClipNotes + DOM мини-нот). Все 11 наборов зелёные (215/215), E2E расширен с 47 до 49 шагов (мини-ноты в добавленном клипе) — прогон 49/49 PASS.
10. [x] Добавить E2E `create project → arrange 2 clips → save → reload → play`: секция 26 в `tests/integration.js` — два клика `+ clip` дают 2 клипа (первый — loop-клип в позиции 0 с мини-нотами, второй — на следующей свободной позиции 1920), проект с обоими клипами (debounce-сохранение) персистится в `sidSynthProject` (loop-клип с событиями), после `page.reload()` оба клипа и мини-ноты восстанавливаются, play двигает playhead, stop сбрасывает. Прогон: E2E 58/58 PASS, все 11 наборов зелёные (215/215).
11. [x] Редактирование клипов мышью в arranger (M2 "Создание, select, move, trim, split, duplicate, loop и delete clips" — первый срез): `snapTicks` в `arrangerLayout.js` (snap к ближайшей шестнадцатой, ppq/4), `engine.moveClip(id, clipId, patch)` в `trackEngine.js` (start/length в PPQ-тиках, clamp start ≥ 0) + `moveClipCommand` в `trackCommands.js` (undo/redo через history). В `arranger.js`: клик по клипу выделяет его (класс `.selected`), pointer-drag перемещает клип с live-preview и snap (учёт scrollLeft и позиции контента через `clientXToTicks`), `Delete`/`Backspace` удаляет выбранный клип через `removeClipCommand` (undoable), клик по пустому месту лейна снимает выбор; CSS `.arranger-clip.selected/.dragging` (cursor grab/grabbing, touch-action: none). Тесты: `arranger-test` до 53/53 (snapTicks, moveClipCommand/removeClipCommand через history, DOM select/drag/delete с PointerEvent). Все 11 наборов зелёные (228/228), E2E расширен с 58 до 63 шагов (секция 27: select, drag на 1 бар с undo, delete с undo) — прогон 63/63 PASS.
12. [x] Trim клипов мышью в arranger (второй срез редактирования): `resize`-состояние в `arranger.js` (`onEdgePointerDown/onEdgeDrag/onEdgeDrop`), зоны `.arranger-clip-edge` (left/right) поверх клипа ловят pointerdown раньше move, перетаскивание правого края меняет length, левого — start (с clamp минимальной длины в одну шестнадцатую, snap по гриду); изменение идёт через `moveClipCommand` (undoable), CSS `.arranger-clip-edge` (cursor ew-resize, hover-подсветка). Тесты: `arranger-test` до 58/58 (resize через moveClipCommand, DOM trim правого/левого края с PointerEvent, click-без-движения не меняет клип). Все 11 наборов зелёные (233/233), E2E расширен с 63 до 65 шагов (секция 28: trim правого края на 1 бар с undo) — прогон 65/65 PASS.
13. [x] Split и duplicate клипов в arranger: `engine.splitClip(id, clipId, atTicks)` в `trackEngine.js` (делит клип на два в абсолютном tick; события распределяются по start, правый сдвигается на offset от точки разреза; вне границ — no-op) + `engine.duplicateClip(id, clipId)` (копия сразу после оригинала); команды `splitClipCommand`/`duplicateClipCommand` в `trackCommands.js` (undo: split восстанавливает length+events левого и удаляет правый; dup удаляет копию). В `arranger.js`: кнопки `split`/`dup` в тулбаре + шорткаты S (split по playhead, если он внутри клипа, иначе по середине) и D (duplicate), все через history. Тесты: `arranger-test` до 64/64 (split/duplicate команды через history с партиционированием событий, DOM S/D шорткаты) + `track-test` до 32/32 (реальный engine: split/duplicate/границы/sync loop-клипа). Все 11 наборов зелёные (243/243), E2E расширен с 65 до 69 шагов (секция 29: S → 3 клипа, undo; D → 3 клипа, undo) — прогон 69/69 PASS.
14. [x] Loop (повтор) клипов в arranger: `engine.repeatClip(id, clipId, times)` в `trackEngine.js` (ставит `times` копий клипа встык от исходного start, events/color/name копируются; times ≤ 1 — no-op) + команда `repeatClipCommand` в `trackCommands.js` (undo удаляет созданные копии). В `arranger.js`: кнопка `loop` в тулбаре + шорткат L (повтор выбранного клипа 3x), через history. Тесты: `arranger-test` до 67/67 (repeatClipCommand через history, no-op при times ≤ 1, DOM L) + `track-test` до 34/34 (реальный engine: 3x встык с правильными start, no-op). Все 11 наборов зелёные (248/248), E2E расширен с 69 до 71 шагов (секция 30: L → 4 клипа, undo) — прогон 71/71 PASS.
 15. [x] Multi-select и range select клипов в arranger (последний пункт M2 "Создание, select, move, trim, split, duplicate, loop и delete clips"): `selection` (массив) + `anchor` вместо одиночного `selected` в `arranger.js` — Ctrl/Cmd+click тумблит клип в/из выделения, Shift+click выделяет диапазон клипов трека-якоря между start якоря и цели, обычный клик сохраняет уже выбранную группу (чтобы её можно было таскать целиком); Delete/Backspace удаляет ВСЕ выбранные клипы. Команды `moveClipsCommand` (двигает несколько клипов на один delta, clamp ≥ 0, undo возвращает все start) и `removeClipsCommand` (удаляет несколько в одной undoable-транзакции, undo восстанавливает с исходными id) в `trackCommands.js`. Drag выбранной группы двигает все клипы вместе (live-preview всех блоков, один `moveClipsCommand` на drop); S/D/L работают по primary (anchor) клипу. Тесты: `arranger-test` до 78/78 (moveClipsCommand/removeClipsCommand через history, Ctrl+click toggle on/off, Shift+click range 3 клипов, Delete всех выбранных с undo, drag группы с undo, S/D/L по anchor, клик по пустому месту сбрасывает группу). Все 11 наборов зелёные (259/259), E2E расширен с 71 до 75 шагов (секция 31: Ctrl+click → 2 выбранных, Delete всех с undo, Shift+click range) — прогон 75/75 PASS.

 16. [x] Markers на timeline (M2 "Markers, loop locators и project end marker" — первый срез): `transport.seek(tick)` в `src/project/transport.js` (абсолютный tick → loopPosTicks/loopCount, работает остановленным и во время игры, пересчёт часов при playing, эмитит onTick + emitState). `src/project/markers.js` — reactive store `createMarkerStore` (getMarkers/add/remove/set/subscribe, sort по tick) + `normalizeMarker`/`sortMarkers`/`addMarker`/`removeMarker`; команды `addMarkerCommand`/`removeMarkerCommand` в `src/project/markerCommands.js` (undoable через history). Персистенция: `markers: []` в `defaultProject.js`, validate/normalize/round-trip в `serialize.js`; `main.js` создаёт store, `captureProject`/`applyProject` сохраняют/восстанавливают, arranger подписан на store (render при изменениях). UI в `arranger.js`: кнопка `+ mrk` в тулбаре добавляет маркер на playhead (`M{n}`), `.arranger-marker`-флаг на ruler с label и кнопкой × (клик = seek к маркеру, × = removeMarkerCommand); стили `.arranger-marker*` в `style.css`. Тесты: `transport-test` до 26/26 (4 seek-теста: absolute tick, clamp 0, loop wrap, при playing), `project-test` до 27/27 (round-trip маркеров, normalize частичных/невалидных, отсутствие поля → `[]`), `arranger-test` до 88/88 (store add/remove/sort, команды через history, + mrk на playhead с undo, рендер флага, клик = seek, × удаляет с undo, set). Все 11 наборов зелёные (278/278), E2E расширен с 75 до 82 шагов (секция 32: + mrk → флаг на ruler, undo/redo, клик по маркеру = seek, × удаляет с undo, персистенция после reload) — прогон 82/82 PASS. Ещё нет: loop locators, project end marker.

 17. [x] Track mute/solo и track headers (M2 "Track reorder, resize, rename, color, folder/collapse, mute/solo/arm/monitor" — первый срез): `muted`/`solo` в модели трека — `defaultTrackConfig`/`getTracks` (`trackEngine.js`), `defaultTrackData` (`defaultProject.js`), normalize `normalizeTrackData` (`serialize.js`), `trackSnapshot` (`trackCommands.js`). Engine: `engine._anySolo()`, `engine.isAudible(id)` (muted → false; если есть хоть один solo-трек — слышны только solo; иначе все), `_applyAudibility()` применяется в `updateTrack`/`addTrack` через `TrackVoices.setGain(value, at)` (gain 0 при не-аудибле, иначе volume; clamp 0..1, try/catch → fallback на `gain.value`). Команда `setTrackFlagCommand(engine, id, key, value)` в `trackCommands.js` (undoable, label от key/value). UI: recorder — кнопки M/S в строке трека (классы `on mute`/`on solo`); arranger — track header в lane (`.arranger-lane-header` с M/S `.arranger-lane-flag` + label), lane получает классы `muted`/`solo`, клик по флагу через history с `stopPropagation`. Стили `.arranger-lane-header`/`.arranger-lane-flag`/`.arranger-lane.muted`/`.rec-btn.on.mute/.solo` в `style.css`. Тесты: `track-test` до 43/43 (9 новых: дефолты, toggle флагов, solo-семантика с несколькими треками, unsolo восстанавливает, muted+solo, getTracks, setGain clamp, gain 0 при mute, восстановление volume), `history-test` до 23/23 (3: setTrackFlagCommand undo/redo для muted/solo), `project-test` до 30/30 (4: дефолты defaultTrackData, round-trip muted/solo, normalize отсутствующих), `recorderUI-test` до 11/11 (3: M/S кнопки в row, M mute undoable, S solo undoable), `arranger-test` до 94/94 (6: header M/S, клик M/S через history + классы lane, redo, muted из старта, клик M не сбрасывает выбор). Все 11 наборов зелёные (302/302), E2E расширен с 82 до 88 шагов (секция 33: M/S в recorder + lane классы, undo, solo, arranger S-флаг, undo) — прогон 88/88 PASS. Ещё нет: reorder/resize/rename/color, folder/collapse, monitor.

 18. [x] Track rename (M2 "Track reorder, resize, rename, color, folder/collapse, mute/solo/arm/monitor" — второй срез): команда `renameTrackCommand(engine, id, name)` в `trackCommands.js` (captures старое имя, undoable, пустое/whitespace имя возвращает null — защита от blank-переименования). UI: двойной клик по имени трека (`.rec-track-name`) в recorder открывает inline input (`.rec-track-name-input`), Enter коммитит через history, Escape отменяет, blur коммитит; тот же паттерн в arranger — dblclick на `.arranger-lane-label` → `.arranger-lane-label-input` (через history, fallback на direct update без history). Idempotent-флаг `done` защищает от двойного commit при blur после render. Стили `.rec-track-name-input`/`.arranger-lane-label-input`/`.rec-track-name` (cursor: text) в `style.css`. `name` уже сериализуется. Тесты: `history-test` до 25/25 (2 новых: rename undo/redo, пустое имя → null), `recorderUI-test` до 14/14 (3: dblclick rename undoable, Escape отменяет, пустое имя игнорируется), `arranger-test` до 98/98 (4: dblclick label rename через history, Escape отменяет, пустое игнорируется, undo восстанавливает текст label). Все 11 наборов зелёные (311/311), E2E расширен с 88 до 93 шагов (секция 34: dblclick recorder name → input, Enter → "Bass 01", undo, dblclick arranger label → "Lead 02") — прогон 93/93 PASS. Ещё нет: reorder/resize/color, folder/collapse, monitor.

 19. [x] Track reorder (M2 "Track reorder, resize, rename, color, folder/collapse, mute/solo/arm/monitor" — третий срез): `engine.reorderTrack(id, toIndex)` в `trackEngine.js` (двигает трек в `tracks` списке, clamp индекса, no-op если на месте/нет трека, `_emitState`) + команда `reorderTrackCommand(engine, id, toIndex)` в `trackCommands.js` (captures индекс до перемещения, undo возвращает позицию, redo применяет target). UI: кнопки ▲/▼ в recorder rows (`.rec-reorder`, у первого ▲ dim, у последнего ▼ dim) и в arranger lane headers (`.arranger-lane-reorder`, тот же dim-паттерн, stopPropagation чтобы не сбрасывать клип-выбор) — оба через history, fallback на прямой `engine.reorderTrack`. Стили `.rec-btn.rec-reorder*`/`.arranger-lane-reorder*` в `style.css`. Порядок треков уже сериализуется (getTracks в порядке tracks), персистенция проверена live после reload. Тесты: `track-test` до 48/48 (5 новых: вниз/вверх/вверх-clamp/по-индексу с byId в синке/no-op/сохранение данных), `history-test` до 27/27 (2: reorder undo/redo позиции), `recorderUI-test` до 16/16 (2: ▲ up undoable, ▼ down + dim первого), `arranger-test` до 101/101 (3: render ▲/▼ с dim, ▲ последнего up undoable + порядок DOM/engine, stopPropagation-safe). Все 11 наборов зелёные (323/323), E2E расширен с 93 до 97 шагов (секция 35: dim первого ▲, ▼ двигает вниз с undo, arranger ▼ синхронит порядок lanes) — прогон 97/97 PASS. Ещё нет: resize/color, folder/collapse, monitor.

 20. [x] Track color (M2 "Track reorder, resize, rename, color, folder/collapse, mute/solo/arm/monitor" — четвёртый срез): `color` уже был в модели (`defaultTrackConfig`/`getTracks`/`defaultTrackData`/`normalizeTrackData`, персистируется) — добавлен только UI: color-input `.rec-track-color` в recorder row (после name, `input`-событие → `updateTrackCommand(engine, id, { color })`, undoable через history) и `.arranger-lane-color` в arranger lane header (через history, fallback на `engine.updateTrack`; импортирован `updateTrackCommand` в arranger.js). Акцент применяется: recorder row `--tcolor`/grid label, arranger lane label `style.color`, клипы `--bcolor`. Стили `.rec-track-color`/`.arranger-lane-color` (+ swatch `::-webkit-color-swatch`) в `style.css`. Персистенция проверена live (reload сохраняет цвет). Тесты: `recorderUI-test` до 18/18 (2: color input re-colors undoable, accent в синке с engine), `arranger-test` до 103/103 (2: color input seeded из трека, изменение undoable + перекрашивает label). E2E: в секции 21-23 исправлены селекторы `input[type="text"]`/`input[type="number"]` вместо позиционных `querySelectorAll('input')[n]` (color input сдвинул индексы); секция 36 (5 шагов: color input в recorder row, перекраска accent, undo, color input в arranger header, перекраска lane label) — E2E 102/102 PASS. Все 11 наборов зелёные (327/327). Ещё нет: resize, folder/collapse, monitor.

 21. [x] Track input monitor (M2 "Track reorder, resize, rename, color, folder/collapse, mute/solo/arm/monitor" — пятый срез): `monitor` уже был в модели (defaultTrackConfig/getTracks/defaultTrackData/migrate/serialize, по умолчанию true; управляет `t.voice.noteOn` живых нот в `noteOn` при невооружённых треках). Добавлены UI-тумблеры: кнопка `MNT` в recorder row (класс `on monitor`, `.rec-btn.on.monitor` в style.css — голубой) и флаг `MNT` в arranger lane header (`mkFlagBtn` обобщён на ключ monitor, класс `arranger-lane-monitor`, стиль `.arranger-lane-flag.on:is(.arranger-lane-monitor)`), оба через `setTrackFlagCommand(engine, id, 'monitor', ...)` — undoable, label 'Enable/Disable monitor' расширен в trackCommands.js. Персистенция проверена live. Тесты: `recorderUI-test` до 19/19 (1: MNT toggle undoable), `arranger-test` до 104/104 (2: render M/S/MNT три флага — обновлён существующий тест, MNT toggle via history). Все 11 наборов зелёные (329/329), E2E расширен с 102 до 105 шагов (секция 37: MNT в recorder row, toggle синхронит arranger-флаг, undo) — прогон 105/105 PASS. Ещё нет: resize, folder/collapse.

 22. [x] Track lane resize (M2 "Track reorder, resize, rename, color, folder/collapse, mute/solo/arm/monitor" — шестой срез): поле `height` (px, null = дефолт) в модели трека — `defaultTrackConfig`/`getTracks` (`trackEngine.js`), `defaultTrackData` (`defaultProject.js`), normalize в `migrate.js`/`serialize.js`, `trackSnapshot` (`trackCommands.js`). Команда `resizeTrackCommand(engine, id, height)` в `trackCommands.js` (undoable, `hadHeight`-флаг для восстановления null). UI: drag-хэндл `.arranger-lane-resize` по нижней границе lane (pointerdown → window pointermove живьём меняет `lane.style.height` и пересчитывает `content.style.height` из актуальных высот треков; pointerup коммитит команду через history, fallback на `engine.updateTrack`). Стили `.arranger-lane-resize` (cursor ns-resize, hover-подсветка) в `style.css`. Персистенция проверена live (86px после reload). Тесты: `history-test` до 28/28 (1: resize undoable, null-восстановление), `arranger-test` до 107/107 (3: дефолтная высота + хэндл, drag +40px коммитит 66px undoable, явная высота трека рендерится). Все 11 наборов зелёные (333/333), E2E расширен с 105 до 108 шагов (секция 38: хэндл, drag растёт lane, undo) — прогон 108/108 PASS. Ещё нет: folder/collapse.

 23. [x] Track folder/collapse (M2 "Track reorder, resize, rename, color, folder/collapse, mute/solo/arm/monitor" — седьмой срез, закрывает M2-bullet): поля `folder` (string|null, id родителя-папки) и `collapsed` (boolean) на треке — `defaultTrackConfig`/`getTracks`/`updateTrack` (`trackEngine.js`), `defaultTrackData` (`defaultProject.js`), normalize в `migrate.js`/`serialize.js`, `trackSnapshot` (`trackCommands.js`). Engine: `engine.folderChildren(id)` (прямые дети по `folder`), `engine.visibleTracks()` (дети скрыты, если `byId[folder].collapsed`). UI: recorder — кнопка ▾/▸ (`.rec-collapse`) в строке трека, `collapsed`-класс на row, grid-строка скрывается при `t.collapsed` (трек без детей) или при свёрнутом родителе (папка остаётся видимой, дети скрыты); arranger — кнопка `.arranger-lane-collapse` в header (после MNT), lane сужается до `COLLAPSED_HEIGHT=18px` если трек свёрнут и без детей (иначе полная высота), lane-дети свёрнутой папки получают `display:none` + класс `collapsed-child`, обе суммы высоты content (render и resize-drag) исключают скрытые лейны. Все через `updateTrackCommand` — undoable. Стили `.rec-btn.rec-collapse`/`.arranger-lane-collapse`/`.rec-track.collapsed` в `style.css`. Персистенция проверена live (collapsed сохраняется после reload). Тесты: `track-test` до 52/52 (4: дефолты folder/collapsed, updateTrack ставит флаги, folderChildren, visibleTracks скрывает детей свёрнутой папки), `project-test` до 33/33 (3: дефолты, round-trip folder+collapsed, normalize отсутствующих), `recorderUI-test` до 21/21 (2: кнопка в row, toggle скрывает grid-строку undoable), `arranger-test` до 110/110 (3: кнопка в header, свёрнутый трек сужается undoable, свёрнутая папка прячет lane-детей). Все 11 наборов зелёные (345/345), E2E расширен с 108 до 111 шагов (секция 39: тумблеры в recorder+arranger, lane сужается до 18px, undo) — прогон 111/111 PASS. M2-bullet закрыт полностью.

## Definition of Done для каждой DAW-функции

- [ ] Состояние сериализуется, имеет migration path и восстанавливается без потерь.
- [ ] Операция поддерживает undo/redo и не оставляет orphan AudioNode/events/assets.
- [ ] Playback корректен после play, pause, seek, loop и tempo change.
- [ ] Есть keyboard/mouse workflow, доступное состояние и понятная ошибка/fallback.
- [ ] Есть unit/integration тесты; для звука — проверка realtime и offline render.
- [ ] Измерено влияние на CPU, память и UI frame time на stress fixture.
- [ ] README/user docs обновлены только после фактической реализации, а не заранее.
