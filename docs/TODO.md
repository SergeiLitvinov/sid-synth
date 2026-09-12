# SID Studio — план развития web-DAW

Обновлено 2026-09-07 по результатам аудита кода. Здесь только незавершённая работа. Реализованные функции описаны в [руководстве](USER_GUIDE.md), результаты проверки — в [аудите](AUDIT.md). Завершённая задача удаляется отсюда после проверки и обновления руководства. Наличие кнопки или теста DOM не означает готовность звукового сценария.

Цель v1: создать проект → записать MIDI/аудио → отредактировать аранжировку → свести → экспортировать и перенести проект. Сохраняем SID-инструмент и современную 8-битную эстетику. Это направление развития, не обещание полного паритета с desktop DAW.

## P0 — музыкальная модель и транспорт

- [x] Seek/loop/pause/resume: исключить дубли chase, повтор законченных нот при late tick, ошибки RT-позиции и прерывание удержанных нот на границе. Готово 2026-09-12: строгое правило chase (`<`, окно `[pos, +0.25s)`, song — finished-флаги + membership региона), транспорт отдаёт движку loopStart/EndTicks + loopCount, wrap делает allOff + resync позиций + очистку флагов (когерентность RT/assert), сустейн на границе ретриггерится обрезанным по региону, pause сохраняет позицию (`paused` в getState), resume — chase + реплей окна без onStart. transport-test 56/56 (8 новых: 2 loop + 5 pause/resume + 1 граница), полный юнит 743/743.
- [x] Подключить PatternSequencer рэка к общему транспорту; менять частоту осциллятора в момент запланированной ноты. Готово 2026-09-12: `attachTransport` (старт/стоп/пауза/продолжение/seek/wrap от транспорта, живой темп из проекта, точный snap после wrap через флаг + guard дрейфа ≥2 шагов), `setTransport` в rackController/main.js, `setFrequency(freq, when)` с `setValueAtTime` в момент ноты, BPM-ввод SEQ блокируется в follow-режиме. tests/sequencer-test 12/12, полный юнит 755/755, app check чистый.
- [ ] Запись в выбранный клип по абсолютной позиции песни; сохранить исходные timestamps, длительности через несколько циклов, velocity и channel. Quantize должен быть обратимым.
- [ ] Запись одной undo-транзакцией, включая REPLACE, cancel take и остановку с удержанными нотами.
- [ ] Стабилизировать асинхронный browser test аудиозаписи: ожидание завершённого take вместо фиксированных задержек, диагностировать редкие сбои fake device под нагрузкой.
- [ ] MIDI: panic/all-notes-off, release при отключении устройства, идентичность device/channel/note, запись/воспроизведение CC/bend/pressure. Сейчас это преимущественно live controls.
- [ ] Chase CC/program/expression/pedal state. Имеющийся note chase не закрывает этот сценарий.
- [ ] Голоса: непрерывный release из уровня attack/decay, voice stealing при lookahead, повтор одной высоты под sustain, modulation на новых голосах; звуковые regression tests.

## P0 — проект и сохранение

- [ ] New/Open/Save/Save As для всего проекта; portable bundle с manifest и media. SAVE PATCH относится только к рэку. Проверить перенос в чистый браузерный профиль.
- [ ] Revision-based autosave, dirty/saved/error status, журнал, резервные снимки и recovery. Убрать MutationObserver и периодическую запись неизменённого состояния; flush перед уходом.
- [ ] Полная валидация: конечные числа, диапазоны, уникальные ID, ссылки на assets/devices/tracks, версии схемы. Сначала подготовить проект, затем атомарно заменить состояние.
- [ ] Стабильные ID рэка при загрузке и clip/event/device/route IDs. Объединить дубли defaultClip/defaultTrack/normalizers; runtime-флаги не должны попадать в snapshots.
- [ ] Сохранять tempo/signature map, layout и record settings; разрешения устройств и AudioNode остаются runtime.
- [ ] Asset lifecycle учитывает клипы, undo-историю и backups. Текущая защита удаления учитывает только клипы открытого проекта; добавить безопасную сборку мусора.
- [ ] Quota/eviction UX, bounded buffer cache и длинные файлы; OPFS как дополнительный backend с fallback.

## P0 — разделение модулей

Границы и порядок рефакторинга: [ARCHITECTURE.md](ARCHITECTURE.md). Изменение структуры и музыкального поведения проводить отдельными проверяемыми срезами.

- [ ] Разделить trackEngine: track repository, clip operations, recording session, scheduler, audibility/routing. UI не должен мутировать tracks/byId/_recBuffer.
- [ ] Разделить pianoRoll: renderer/layout, gestures, selection, transforms toolbar, step input, drum editor, audio inspector. Сохранить чистые helpers quantize/transpose/humanize.
- [ ] Разделить arranger: viewport/ruler, headers, clip gestures, selection, markers/locators. Переиспользовать track actions в recorder/mixer.
- [ ] Разделить recorderUI: transport bar, track list, step grid, insert editor; убрать HTML-шаблоны и подмену engine methods.
- [ ] Разделить inputUI на device/monitor view и take controller с pending/start/record/finalize/cancel. Take привязан к треку и позиции старта, не к выбору в конце.
- [ ] Подписки с unsubscribe вместо перезаписи onStateChange/onTick и обёрток методов каждым UI. Один владелец dispose у каждого ресурса.
- [ ] Общий action dispatcher и shortcut scopes; текстовый ввод не запускает команды arranger/piano roll.
- [ ] DOM-free audio/device factories и parameter registry. AudioComponent — только база rack UI, не всех моделей DAW.
- [ ] History transactions и лимит памяти; undo восстанавливает порядок, selection, velocity, events и audio refs без shared mutable объектов.
- [ ] Устройства адресуются stable ID: unknown insert не смещает управление известными; исключить лишние connect при смене фильтра/chain.

## P1 — UI/UX: современная 8-битная рабочая станция

Спецификация: [UI_UX.md](UI_UX.md). Сначала рабочие сценарии и композиция, затем визуальная полировка.

- [ ] Один верхний transport: play/pause/stop/record, позиция, tempo, loop, metronome и save status. Ясно различать MIDI record и audio take.
- [ ] Arranger в центре, track headers слева, browser/inspector сбоку, piano/audio editor в нижнем dock; SID Rack отдельным workspace/device view.
- [ ] Контекстный inspector выбранного объекта, понятные empty states и одно основное действие в каждом.
- [ ] Подписи вместо неоднозначных букв: Add track, Split, Duplicate, Quantize, Record audio; tooltips с shortcut и компактный режим.
- [ ] Клик выделяет ноту; удаление — Delete/Erase. Выделение не меняет музыку.
- [ ] Явные режимы STEP/DRUM/Draw/Select; musical typing и DAW shortcuts разделены фокусом.
- [ ] Независимые scroll/zoom, sticky headers, fit song/selection, track-height presets; виртуализация по видимым трекам/времени.
- [ ] Design tokens: тёмные нейтральные поверхности, phosphor-green accent, дополнительные цвета audio/modulation/record; pixel edges и локальный glow.
- [ ] Читабельный текст, масштаб 100–200%, keyboard focus, aria-label/pressed, контраст, reduced motion; состояние не кодируется только цветом.
- [ ] Локальный/system font fallback, RU/EN строки вне компонентов; декоративный CRT не отнимает рабочую область.
- [ ] Проверить первую мелодию, запись микрофона, импорт/trim, undo и export на 1366×768, 1920×1080 и browser zoom 200%.

## P1 — запись и аудиоредактирование

- [ ] Input/round-trip calibration, точный старт после подготовки worklet и audio clock. Output latency + ручная поправка не заменяют калибровку.
- [ ] Count-in/punch синхронизировать с транспортом; absolute position, clipping у нуля, cancel во время подготовки, отсутствие orphan asset после неудачного размещения.
- [ ] Take lanes, loop takes, comping и crossfades между дублями; отдельные clips не заменяют comping.
- [ ] Mono/stereo input channel selector, monitor Auto/On/Off, feedback guard и input meters.
- [ ] Streaming/lazy decode, многомасштабные peaks, cancellation workers и понятные причины import/decode failure.
- [ ] Slip/ripple/nudge/consolidate; offline time-stretch/pitch-shift с preview, затем warp/transients.

## P1 — микшер, эффекты, SID и automation

- [ ] Channel strips instrument/audio/bus/return/master: gain, pan, meters, mute/solo/output. Текущие M/S и inserts — основа, не законченная консоль.
- [ ] Buses, sends pre/post-fader, returns, sidechain, routing matrix и cycle/feedback policy.
- [ ] Peak/RMS/clip hold, headroom, optional limiter; solo propagation через folders/buses, exclusive solo.
- [ ] Inserts reorder/bypass/wet-dry, presets, delay compensation; EQ, compressor, gate и saturation.
- [ ] SID Rack как инструмент трека: patch definition отдельно от per-voice runtime, voice allocation, parameter registry.
- [ ] Режим 3 voices, PWM/sync/ring-mod UI, shared filter, модели 6581/8580 с описанными приближениями. Notch/allpass, сворачивание и mini visualizers модулей.
- [ ] Automation lanes/curves, Read/Touch/Latch/Write, gesture undo, seek/loop chase, AudioParam scheduling, clip envelopes и приоритет manual/automation/modulation.
- [ ] Factory/user presets с search/tags, track/project templates, freeze/unfreeze и bounce in place.

## P0 перед v1 — экспорт и переносимость

- [ ] OfflineAudioContext render с тем же графом/событиями, что playback. Текущий WAV — захват 4 тактов живого master через ScriptProcessor.
- [ ] WAV 16/24/32-float, выбор диапазона/частоты, хвосты эффектов, dithering, stems, progress/cancel и memory budget.
- [ ] Убрать ScriptProcessor из realtime bounce, завершать по аудиофреймам, обрабатывать interruption. Тест кодера не равен тесту полного рендера.
- [ ] SMF MIDI import/export (0/1) с tempo/signatures/channels; project bundle, relink и перенос на чистый профиль.

## Проверка качества

- [ ] E2E пользовательских сценариев проверяет записанные/проигранные события и звук, а не только наличие DOM-кнопок.
- [ ] OfflineAudioContext fixtures: envelopes, clipping, seek, offsets, inserts, mixdown; численные допуски вместо битовой идентичности браузеров.
- [ ] Проверенная browser/version/API matrix; прежнее «полная поддержка Chrome 60+» не подтверждено для DAW.
- [ ] Stress fixtures: 50 tracks, 10 тысяч нот/клипов, длинное audio; CPU/RAM/latency/UI frame time на указанной reference machine.
- [ ] Lifecycle после повторных load/delete/undo, скрытой вкладки, отключения MIDI/микрофона и закрытия приложения.

Функция готова, когда сценарий доступен в UI, данные сохраняются, undo корректен, playback/seek/loop согласованы, ошибки видны, тесты проверяют результат и обновлено руководство. Структурное описание схемы не считается полной валидацией.

## После устойчивой v1

- [ ] MPE/per-note expression, MIDI learn/control surfaces, action list/macros и screensets.
- [ ] Video/timecode/SMPTE, multichannel/surround и AAF/OMF/ADM — отдельные этапы.
- [ ] PWA/offline storage; опциональные cloud sync, versioning и collaboration.
- [ ] Web device SDK и sandboxed extensions; native plugin bridge/desktop companion — отдельное решение.

## Следующий порядок работ

1. Удаление legacy grid/rt backing и выбор редактируемого/записываемого clip ID.
2. Scheduler/recording lifecycle и validation project replacement.
3. Open/Save/bundle и event-based autosave.
4. Общие actions/subscriptions, разделение больших редакторов.
5. DAW workspace по UI_UX.md.
6. Mixer/routing → automation → offline export → стабилизация v1.
