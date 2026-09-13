# SID Studio — план развития web-DAW

Обновлено 2026-09-13 по результатам аудита кода. Здесь только незавершённая работа. Реализованные функции описаны в [руководстве](USER_GUIDE.md), результаты проверки — в [аудите](AUDIT.md). Завершённая задача удаляется отсюда после проверки и обновления руководства. Наличие кнопки или теста DOM не означает готовность звукового сценария.

Цель v1: создать проект → записать MIDI/аудио → отредактировать аранжировку → свести → экспортировать и перенести проект. Сохраняем SID-инструмент и современную 8-битную эстетику. Это направление развития, не обещание полного паритета с desktop DAW.

## Повторно открыто после аудита 2026-09-13

Подробное сопоставление закрытых пунктов с реализацией: [AUDIT_2026-09-13.md](AUDIT_2026-09-13.md).

- [ ] Фиксировать track/clip ID и геометрию цели при старте MIDI take; смена выбора, перемещение или удаление клипа не должны перенаправлять запись. Проверить REPLACE/CANCEL и один undo при параллельных правках.
- [ ] Записывать controller events во времени (CC, bend, pressure, program, pedal), а не только snapshot на note-on. Chase восстанавливает состояние в паузах и сбрасывает нейтральные значения; устройство/канал сохраняют идентичность до голоса.
- [ ] Проверить непрерывность удержанных нот при loop/seek на реальном звуке: обрезанный retrigger не равен непрерывному sustain.
- [ ] Защита New/Open от потери rack/live/media правок вне history; восстановление при ошибке commit callback. Журнал изменений autosave должен переживать reload, если заявлен долговечным.
- [ ] Полноценный единый transport UI с PAUSE и ясным MIDI/audio REC; сохранять metronomeEnabled. LOOP/METRO в старом recorder не закрывают workspace redesign.
- [ ] Актуализировать legacy integration journey, убрать старые ожидания grid/rt/DOM, заменить фиксированные задержки проверяемой готовностью. Не смешивать его результаты с основными browser suites.

## P0 — музыкальная модель и транспорт


## P0 — проект и сохранение

- [ ] Полная валидация: конечные числа, диапазоны, уникальные ID, ссылки на assets/devices/tracks, версии схемы. Сначала подготовить проект, затем атомарно заменить состояние. Реализация подготовлена 2026-09-13: строгая проверка до нормализации, независимая копия документа, подготовка рэка/голосов с освобождением частичных аудиографов, защита restore/recovery. Model suites 411/411 (включая 36 тестов из PR #1); rack preparation 5/5 с mock DOM/AudioContext. Пункт остаётся открытым до полного browser/UI-прогона: запуск Chrome блокируется ограничением socket в окружении разработки. Подробности и команды — [PROJECT_VALIDATION.md](PROJECT_VALIDATION.md).
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
