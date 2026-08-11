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
- [x] True полифония — частично: `activeNotes`-гейт (mono last-note); per-voice ADSR — НЕ сделано (конфликтует с модульным одноканальным сигнальным трактом; нужно дизайн-решение: аллокация голосов)
- [x] Splitter: маршрутизация каналов (индексы) в `drawConnections` / `addConnection` (`outChannel` в `connections`, `data-channel` на портах)
- [x] LFO: модуляция `AudioParam` — соединение `lfo → target` помечается `mod:true`, подключается к `getModParam()` (частота OSC / cutoff фильтра), кабель рисуется розовым; у осциллятора появился вход (mod/aux)
- [x] Секвенсор: ноты с октавами + lookahead-шейдулинг по `ctx.currentTime` (`PatternSequencer._schedule`, `scheduleNote` в main.js)

## P2 — Качество

- [x] ~~`package.json`, eslint + prettier~~ — ОТМЕНЕНО по решению пользователя: без внешних зависимостей, без Node (браузерные тесты + `serve.py` на python)
- [x] Декомпозиция `main.js` (973 → 377 строк): `src/services/*` — `router.js` (соединения/порты/клавиши Escape-Del), `notes.js`, `presets.js`, `componentParams.js`, `keyboard.js`, `midi.js`, `visualization.js`, `patchStore.js`, `patchFile.js`; регрессия: интеграционный тест 11/11
- [x] `src/components/index.js` — экспорт всех компонентов (+ Knob)
- [x] Починить CSS: убран дубль `.component-header`, невалидные hex `#4af7430`/`#4af7433`/`#4af7422` → `#4af743`/`#4af742`
- [x] Обновить README (актуальная структура: `modulator/`, `sequencer/`, `lp/hp/bp`, `nonlinear`; фичи LFO-модуляции, splitter, seq)
- [x] Тесты — только браузерные, без Node: `tests/smoke.html/js` (реальный AudioContext, 10/10), `tests/mock-test.html/js` (unit-эквивалент на `tests/mockAudioContext.js`, 11/11). Запуск: `serve.py` + открыть страницу/Playwright
- [x] Dev-сервер: `serve.py` отдаёт `Cache-Control: no-store` (вместо `python -m http.server`); `serve.ps1` переключён на него

## Анализ (кратко)

- Модульная архитектура: `AudioComponent` (base) → конкретные компоненты; аудио-ядра живут в `oscillator/`, `filter/`, `effects/`, `envelope/`, `modulator/`, `sequencer/`.
- `main.js` — монолит 684 строки: drag&drop, роутинг патч-кордов, клавиатура, пресеты, визуализация, MIDI.
- Критический дефект на момент аудита: `savePatch`/`loadPatch` вызываются, но не объявлены.