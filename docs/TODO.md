# SID Studio — вехи развития web-DAW

Обновлено 2026-09-13; база main `96d7fb1` дополнена первым этапом M3. В списках задач только незавершённая работа. Доступные возможности и безопасные способы работы описаны в [руководстве](USER_GUIDE.md), технические контракты — в [DEVELOPMENT.md](DEVELOPMENT.md).

Цель v1: создать проект → записать MIDI/аудио → собрать аранжировку → свести → экспортировать и перенести песню. Это web-DAW с SID-характером, не обещание полного паритета с Reaper/Pro Tools.

## Порядок и правила завершения

**Текущая веха — M3: UI/UX, по запросу пользователя.** Следующий срез: безопасный выбор/удаление нот (M3.3), понятные команды и режимы редакторов (M3.4–M3.5). Затем M1 → M2 → M4 → M5 → M6 → M7. Критические исправления потери данных из M1 не откладывать ради оформления; необходимые части M2 выносить вместе с соответствующим UI, не создавать новый монолит. M5/M6 опираются на устойчивые clock/device contracts.

Каждый пункт закрывается только после проверки UI-сценария, save/load, Undo/Redo, playback/seek/loop и сообщений об ошибках. Тест должен проверять результат, а не наличие кнопки. Выполненный пункт удаляется отсюда, инструкция появляется в руководстве. Новые аудиты не создают параллельных списков задач.

## M1 — надёжность текущей музыки и проекта

Результат: существующими возможностями можно пользоваться без перенаправления записи и незаметной потери данных.

- [ ] **M1.1** Зафиксировать track/clip ID и геометрию MIDI take при старте; смена выбора, trim/move/delete не перенаправляют запись. REPLACE/CANCEL/STOP и один Undo сохраняют исходные данные при параллельных правках.
- [ ] **M1.2** Сохранять MIDI source offset при Duplicate/Repeat обрезанного клипа: сейчас копирование передаёт events/length, но не offset. Проверить split → trim → duplicate/repeat → save/load → Undo и ноты через границу.
- [ ] **M1.3** Проверить cancellation/rescheduling при edit/delete/Undo во время playback; chase не дублирует ноты. Проверить удержанные ноты при loop/seek на реальном звуке: retrigger не равен непрерывному sustain.
- [ ] **M1.4** Dirty state охватывает rack/live/media правки вне history; New/Open не теряют их. Защитить асинхронные Save/Open от редактирования во время операции, отказов и неполных media.
- [ ] **M1.5** Дополнить staged project replacement откатом при исключении commit callbacks. Проверить повторные New/Open, отказ подготовки, импорт во время playback и ошибки размещения assets.
- [ ] **M1.6** Довести валидацию всех device parameters и границ схемы; исключить runtime scheduling fields из сохранения. Базовые проверки чисел, ID, ссылок и подготовка графа уже реализованы — не создавать их заново.
- [ ] **M1.7** Asset lifecycle учитывает клипы, Undo и backups; безопасная сборка мусора, quota/eviction/recovery UX и долговечный журнал. Текущий manifest и локальные backups не заменяют эти гарантии.
- [ ] **M1.8** Разобрать 64 падения legacy E2E (последний результат: 186 passed / 64 failed), отделить дефекты приложения от устаревших grid/rt/DOM ожиданий. Заменить задержки готовностью и проверять музыку/сохранение, не только DOM.
- [ ] **M1.9** Исправить neutral reset bend/mod/pressure/program при playback/chase; проверить два устройства/канала с одной высотой до уровня голоса.

Приёмка: create → record → edit → save → clean-profile open → play проходит; ошибки не меняют предыдущий проект; все актуальные E2E имеют объяснимый и воспроизводимый результат.

## M2 — модульное ядро и единые команды

Результат: новые DAW-функции добавляются без расширения god objects.

- [ ] **M2.1** Разделить trackEngine на track repository, clip operations, recording session, scheduler и audibility/routing. UI не мутирует tracks/byId/private fields.
- [ ] **M2.2** Разделить pianoRoll: layout/render, gestures, selection, transforms toolbar, STEP, DRUM, audio inspector. Уже существующие чистые transforms переиспользовать; PR с тестами не считать декомпозицией.
- [ ] **M2.3** Разделить arranger: viewport/ruler, headers, clip gestures, selection, markers/locators; общие track actions с recorder/mixer.
- [ ] **M2.4** Разделить recorderUI: transport, track list, step grid, MIDI list, insert editor; inputUI: device/monitor view и take lifecycle pending/start/record/finalize/cancel.
- [ ] **M2.5** Общие actions/shortcut scopes и subscriptions с unsubscribe; убрать подмену engine methods/onTick/onStateChange. Один владелец dispose на ресурс.
- [ ] **M2.6** DOM-free graph/device factories и parameter registry; AudioComponent остаётся базой только визуального rack. Устранить расходящиеся defaults/normalizers.
- [ ] **M2.7** Стабильные event/route/device IDs на всех mutation/load путях; управление insert по ID, не индексу. Unknown device не смещает управление, rebuild не создаёт лишних connect.
- [ ] **M2.8** History transactions с лимитом памяти и глубокими snapshots (events, velocity, audio refs, порядок, selection). Один gesture — одна транзакция.
- [ ] **M2.9** Единые musical-time и audio-clock контракты для rack, MIDI/audio и export; все потребители учитывают tempo/signature map. Сохранять карты, record settings, metronomeEnabled и layout; разрешения/AudioNode остаются runtime.

Приёмка: каждый вынесенный модуль имеет контракт и тесты; музыкальное поведение не меняется от структурного рефакторинга, подписки и ресурсы освобождаются.

## M3 — понятный современный 8-битный интерфейс

Статус на 2026-09-13: **первый этап выполнен, веха в работе**. Внедрены новая компоновка с вкладками и регулируемым нижним редактором, отдельный SID Rack, верхний транспорт с Pause и целью MIDI-записи, базовые стили без CDN-шрифта, сворачиваемая обработка нот и защита команд скрытых редакторов. Пользовательские инструкции перенесены в [руководство](USER_GUIDE.md#где-что-находится); выполненные части исключены из задач ниже. Проверка: 28 актуальных наборов, 969 passed / 0 failed; legacy integration сюда не входит.

Результат: arranger виден сразу, выбор не удаляет музыку, тип и цель записи очевидны.

- [ ] **M3.1** Доработать существующий верхний транспорт: подробная цель MIDI с каналом и выбранным клипом, явная цель audio take и статус подготовки/записи даже при скрытом INPUT; индикатор времени учитывает signature map. Сгруппировать вторичные настройки без перегруженной строки.
- [ ] **M3.2** Развить готовую компоновку: независимые track headers, контекстный inspector, dock для будущего микшера (M5), сохранение высоты/вкладок/viewport после перезагрузки. Устранить дублирование track controls в arranger и recorder через общие actions.
- [ ] **M3.3** Общий выбор объекта связывает редакторы/inspector. Клик выделяет ноту, Delete/Erase удаляют; Esc отменяет gesture, audition включается явно.
- [ ] **M3.4** Понятные подписи вместо dup/mrk/CLR/INS, tooltip+shortcut и compact mode. Контекстные empty states с одним основным действием; открытая панель transforms сохраняет доступ к сетке на малой высоте.
- [ ] **M3.5** Явные Select/Draw/STEP/DRUM режимы и единый реестр shortcut scopes вместо оставшихся отдельных обработчиков; проверить удержанные ноты/STEP при смене фокуса. Numeric input дополняет knobs; wheel не меняет параметр при прокрутке.
- [ ] **M3.6** Sticky headers, независимые scroll/zoom, fit song/selection, track-height presets, виртуализация видимой области и ясные drag previews.
- [ ] **M3.7** Распространить введённые design tokens на содержимое всех редакторов, rack ports/knobs и состояния; отдельные audio/modulation/record цвета. Удалить дублирующие старые стили после переноса, сохранить pixel edges и только локальный glow.
- [ ] **M3.8** Вынести RU/EN строки из компонентов, проверить контраст и accessibility каждого musical control. Состояние не только цветом; обеспечить touch ≥44 px, убрать обрезание мини-кнопок дорожек. Системный шрифт без CDN, focus ring, reduced motion и клавиатурные вкладки уже есть.
- [ ] **M3.9** Пройти первую мелодию, микрофон, импорт/trim, Undo и export на 1366×768, 1920×1080 и реальном zoom 200%; сохранить screenshot baseline для регрессий. Проверки ширины 390/683/1366/1920 px и видимости timeline не заменяют эти сквозные сценарии.

Приёмка: timeline и transport доступны без прокрутки страницы; новичок различает «MIDI → Lead» и «Audio → Input / Track»; выбор не меняет данные; все основные действия доступны клавиатурой.

## M4 — полноценная запись и редактирование исполнения

Результат: исполнение сохраняется и редактируется как сыграно, а не как набор упрощённых note-on snapshots.

- [ ] **M4.1** Controller timeline: CC/bend/pressure/program/pedal events, device/channel identity, запись и chase во время нот и пауз. Отдельный UI обратимого quantize с исходными timestamps.
- [ ] **M4.2** Input/round-trip calibration, mono/stereo channel selector, monitor Auto/On/Off, feedback guard и input meters.
- [ ] **M4.3** Count-in/punch по общему transport/audio clock; точный старт после worklet readiness, absolute placement, clip у нуля, cancel во время подготовки, отсутствие orphan asset при ошибке размещения.
- [ ] **M4.4** Loop takes, take lanes, comping и crossfades между дублями; отдельные клипы не считать готовым comping.
- [ ] **M4.5** Streaming/lazy decode, ограниченный buffer cache, многомасштабные peaks, отмена workers и понятные import/decode ошибки; исследовать OPFS с fallback.
- [ ] **M4.6** Slip/ripple/nudge/consolidate; offline time-stretch/pitch-shift с preview, затем warp/transients.
- [ ] **M4.7** MIDI 0–127 в редакторе с удобной навигацией; полноценный UI folder/group создания без смешения с будущими audio buses.

Приёмка: записанный MIDI-controller жест и аудио take воспроизводятся с проверенными временем/динамикой; калибровка проверена устройством; cancel и comping не теряют исходник.

## M5 — микшер, устройства и automation

Результат: аранжировка превращается в управляемый микс.

- [ ] **M5.1** Channel strips instrument/audio/bus/return/master: gain, pan, meters, mute/solo/output; buses, pre/post sends, returns, sidechain и routing matrix с cycle/feedback policy.
- [ ] **M5.2** Peak/RMS/clip hold/headroom, optional limiter; solo propagation через folders/buses и exclusive solo.
- [ ] **M5.3** Inserts reorder/bypass/wet-dry/presets, delay compensation; EQ, compressor, gate и saturation.
- [ ] **M5.4** SID Rack как инструмент трека: patch definition отдельно от per-voice runtime, voice allocation и parameter registry.
- [ ] **M5.5** SID 3-voice mode, PWM/sync/ring-mod UI, shared filter, модели 6581/8580 с явными приближениями. Rack notch/allpass, collapse и mini visualizers.
- [ ] **M5.6** Automation lanes/curves, Read/Touch/Latch/Write, gesture Undo, seek/loop chase, AudioParam scheduling, clip envelopes; явный приоритет manual/automation/modulation.
- [ ] **M5.7** Factory/user preset search/tags, track/project templates, freeze/unfreeze и bounce in place.

Приёмка: routing/solo/automation дают тот же результат после load/seek/loop; схема сигналов понятна пользователю, задержки компенсируются.

## M6 — полный экспорт и обмен

Результат: всю песню можно отдать вне приложения с предсказуемым звучанием.

- [ ] **M6.1** OfflineAudioContext render на тех же factories/events, что playback; parity для rack, clip offsets, automation, inserts и bus routing.
- [ ] **M6.2** WAV 16/24/32-float, диапазон/частота, хвосты эффектов, dithering, stems, progress/cancel и memory budget.
- [ ] **M6.3** Заменить ScriptProcessor в realtime bounce; завершение по аудиофреймам и обработка interruption. Проверить весь путь микс → файл, не только кодер.
- [ ] **M6.4** SMF MIDI 0/1 import/export с tempo/signatures/channels.
- [ ] **M6.5** Приёмка большого portable bundle и relink в чистом профиле: missing/tampered media, quota, длинное аудио и отмена. Базовый SAVE/OPEN bundle уже существует.

Приёмка: offline и realtime результаты совпадают в численных допусках; экспорт всей песни и stems открывается вне приложения; переносимый проект не зависит от старого origin.

## M7 — выпуск устойчивой v1

- [ ] **M7.1** Сквозные тесты полного пути create → MIDI/audio record → arrange → mix → save/load → export, включая ошибки и Undo.
- [ ] **M7.2** OfflineAudioContext fixtures для envelopes/stealing/sustain, clipping, seek, offsets, inserts и mixdown; сравнение samples с допусками.
- [ ] **M7.3** Browser/version/API matrix и физические MIDI/микрофонные проверки; отсутствие ошибок в Edge не равно полной поддержке Firefox/Safari.
- [ ] **M7.4** Stress на reference machine: 50 tracks, 10 тысяч нот/клипов, длинное audio; CPU/RAM/latency/UI frame time и бюджеты.
- [ ] **M7.5** Lifecycle после многократных load/delete/Undo, скрытой вкладки, disconnect MIDI/микрофона и закрытия приложения; отсутствие утечек и зависших нот.
- [ ] **M7.6** Актуальное руководство и технический справочник; проверка ссылок и согласованности реализованных возможностей с планом.

Приёмка: M1–M6 закрыты подтверждёнными сценариями; известные ограничения выпуска перечислены явно, тесты воспроизводимы без Node.

## После v1 — отдельные направления

- [ ] MPE/per-note expression, MIDI learn/control surfaces, action list/macros и screensets.
- [ ] Video/timecode/SMPTE, multichannel/surround, AAF/OMF/ADM.
- [ ] PWA/offline storage, опциональные cloud sync/versioning/collaboration.
- [ ] Web device SDK и sandboxed extensions; native plugin bridge/desktop companion — отдельное решение.
