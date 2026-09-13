# SID Studio — справочник разработчика

Редакция 2026-09-13. Текущие возможности — в [руководстве](USER_GUIDE.md), незавершённые задачи и критерии приёмки — в [TODO](TODO.md). Этот файл объединяет устройство кода, формат проекта, правила разработки и проверку; отдельные списки работ здесь не ведутся.

## Среда и навигация

Приложение — нативные ES modules, Web Audio API, DOM/CSS. Node/npm, сборщик и внешние runtime-библиотеки не нужны. Статический сервер: `python serve.py . 3000` или `pwsh -File tests/serve-ps.ps1` (3100). Используйте стабильный origin для пользовательских данных.

| Путь | Текущая ответственность |
|---|---|
| src/main.js | Сборка приложения, связывание MIDI/audio/UI, файловые действия проекта |
| src/ui/workspace.js, shortcutScope.js; workspace.css | Компоновка и вкладки живых панелей, resize dock, отображение транспорта, границы keyboard-команд и новые стили; без музыкальных мутаций |
| src/project/projectSession.js | Capture, проверка/подготовка и принятие project state |
| src/project/serialize.js, validation.js, migrate.js | Сериализация, валидация, копирование и миграция |
| src/project/projectStore.js, projectFiles.js | Local autosave/recovery и portable bundle |
| src/project/history.js, trackCommands.js | История и команды правок |
| src/project/transport.js, tempoMap.js, musicalTime.js | PPQ clock, карты времени, schedulers и listeners |
| src/rack/rackController.js | Создание/подготовка rack, соединения, клавиши, patch/presets |
| src/tracks/trackEngine.js, stepEngineAdapter.js | Треки/клипы, scheduler/recording и связь с transport |
| src/tracks/liveInput.js, clipSelection.js | Получатели held notes и сессионный выбор step-клипа |
| src/tracks/voiceEngine.js, inserts.js | Полифонические голоса и insert runtime |
| src/arranger/ | Arranger, Piano/Drum, layout и чистые transforms |
| src/audio/ | Assets/import, capture/input UI, playback, waveform, staged-node cleanup |
| src/components/, src/services/ | Визуальные rack-компоненты и вспомогательные сервисы |

TrackEngine, pianoRoll, arranger, recorderUI и inputUI пока объединяют слишком много обязанностей. Их разделение — M2, а не уже выполненная характеристика проекта. Размер файла не заменяет анализ ответственности.

Целевое направление: UI → commands/actions → project/track/clip data → scheduler/device runtime. Persistence читает данные; bootstrap связывает домены. Project, DSP и commands не наследуются от визуального AudioComponent.

### Важные текущие контракты

- `getTracks()` отдаёт снимки, не синхронизирует музыку при чтении. Ноты живут в `clip.events`; grid/rt старых проектов преобразуются при загрузке, не являются второй текущей моделью.
- `getStepClip/getStepGrid/selectStepClip` адресуют выбранный клип по ID. Без явного выбора — клип на нуле либо первый доступный. Сессионный выбор используется step editor, PATTERN и MIDI recording; не сохраняется в проект.
- `prepareRecording` используется движком и transport adapter. Live note-off направляется исходным получателям, даже после смены active/arm.
- `projectSession.prepareProject` создаёт новые rack/voices до замены. `audio/prepareAudio.js` помогает освободить частично выделенные nodes.
- Transforms quantize/transpose/duplicate/legato/fixedLength/humanize/preview — отдельные чистые helpers; это не означает, что UI Piano Roll уже декомпозирован.
- Workspace собирается после bootstrap из существующих DOM-панелей, сохраняя их listeners и engines. `onLayout` перерисовывает rack connections после открытия вкладок. Панели с `data-shortcut-scope` принимают команды только внутри своей области фокуса; скрытые панели их игнорируют. `transport.onTick/onStateChange` возвращают unsubscribe. Полный lifecycle всех старых подписок остаётся M2.

## Формат проекта

Версия схемы — **1**, PPQ — **480**. Один такт 4/4 — 1920 ticks, шестнадцатая — 120. Не менять PPQ без согласованной миграции всех consumers.

| Объект | Поля и единицы |
|---|---|
| Project | schemaVersion, id, name, createdAt/modifiedAt; tempo в BPM; playbackMode song/pattern |
| Project transport | loopEnabled, loopStartTicks, loopEndTicks, projectEndTicks (null или ticks) |
| Rack | components и connections |
| Component | id, type, x/y в px, params; типы oscillator/filter/adsr/effects/lfo/mixer/splitter/sequencer |
| Connection | from, to (ID либо master), toChannel (null или mixer input), outChannel, mod |
| Track | id/name/color; enabled/monitor/muted/solo; height/folder/collapsed; volume 0–1 |
| Track instrument | wave, filterType/filterFreq/filterQ, adsr a/d/s/r, gridNote/gridDur (длина в шагах), midiChannel |
| Track data | clips; inserts из id/type/params, типы delay/reverb |
| MIDI channel | В JSON **0–15** либо null (Omni); UI показывает 1–16 |
| Clip | id/name/color, start/length/offset в ticks, events, audio |
| Event | note строкой, start/dur в ticks источника, velocity 0–127; optional channel/device/bend/mod/pressure/pgm/rawStart |
| Clip audio | null либо hash/offset/gain/fadeIn/fadeOut; audio offset/fades в **секундах**, не ticks |
| Assets | Manifest: hash/name/mime/size/sampleRate/channels/duration/createdAt; blobs отдельно |
| Markers | id/name/tick |
| Selection | activeTrackId сохраняется; выбор step-клипа — runtime |

Clip — окно исходных MIDI-событий `[offset, offset + length)`. Позиция события в песне: `clip.start + event.start - clip.offset`; playback ограничивается границами окна. Trim/split сохраняют исходные события. MIDI offset и audio.offset — разные величины. Не гарантировать точную копию обрезанного клипа, пока M1.2 не закрыт.

`rawStart` сохраняет исходный старт record quantize, `device` — происхождение внешнего MIDI-ввода, не ссылка на устройство rack. Снимки expression на note-on не заменяют controller timeline. Runtime voice/DOM/timers не относятся к формату; исключение всех scheduling fields требует регрессий M1.6.

Сейчас сохраняется один tempo, а не полная tempo/signature map; metronomeEnabled и полный layout/record settings ещё не сериализуются. Для IDs не обещается UUID; отсутствующие поддерживаемые ID могут генерироваться при нормализации. Unknown fields не обязаны переживать round-trip.

### Минимальный документ

Парсер добавит отсутствующие необязательные поля:

```json
{
  "schemaVersion": 1,
  "id": "proj_example",
  "name": "Example",
  "tempo": 120,
  "playbackMode": "song",
  "rack": { "components": [], "connections": [] },
  "tracks": [],
  "assets": [],
  "markers": [],
  "activeTrackId": null
}
```

Новая сессия и NEW явно выбирают SONG. Отсутствующий playbackMode в старом документе нормализуется в PATTERN. `loopEnabled` — независимый повтор locator-региона, не выбор SONG/PATTERN.

### Проверка и миграция

`parseProject` проверяет вход **до** нормализации, копирует документ, добавляет отсутствующие значения и повторно проверяет результат. Ошибки включают путь поля; явно повреждённое значение не должно превращаться в default.

- Поддерживается schemaVersion 1; отсутствие версии допускается для legacy. Явные 0/отрицательная/дробная/строковая/null/будущая версии отвергаются. Bundle version должен быть 1.
- Числа, включая extension data, конечные; tempo 1–1000, положительные lengths, неотрицательные позиции/offsets, конец loop больше начала.
- Ноты MIDI 0–127, channel 0–15, velocity 0–127, bend −1–1, mod/pressure 0–1. Volume/sustain 0–1; времена огибающей и gains/fades неотрицательны.
- Rack/insert types и известные параметры ограничены поддержанными диапазонами; детали — `src/project/validation.js`. Полнота всех параметров остаётся отдельной приёмкой.
- Проверяются уникальность ID в соответствующих сущностях, ссылки tracks/folders/devices/assets, циклы folders, duplicate routes, порты rack и опасные object keys.
- Ссылка clip.audio.hash должна быть в manifest. Отсутствие самого Blob при правильном manifest обрабатывается как missing media, не как неверная ссылка.
- Старые grid/rt мигрируют в события клипа. Раздельные `sidSynthAutosave` и `sidSynthTracks` переносятся в единый проект; удаляются лишь после успешной записи.

### Подготовка и замена

Session валидирует проект и создаёт detached muted rack/новые voices. При ошибке подготовки staged resources освобождаются, текущий проект/история сохраняются. Synchronous commit принимает граф, metadata/locators и сбрасывает history; повторный commit подготовленного объекта запрещён.

Это гарантия проверки/подготовки, **не** доказанная транзакция при произвольном исключении внедрённых callbacks внутри commit. Ошибки этого этапа, параллельные Save/Open и media rollback относятся к M1.4–M1.5.

### Хранение и файлы

`sidSynthProject` в localStorage содержит JSON; blobs в IndexedDB того же origin. Разные host/port/profile — разные хранилища.

ProjectStore: saveNow/save/markDirty/flush, restore/readRaw/readProject/clear, recoverSnapshot/listSnapshots, getSaveState/getJournal/isBlocked/subscribe. Debounce по умолчанию 600 ms, FNV-1a revision по JSON; одинаковое содержимое не переписывается. Created/modified timestamps стабилизированы в session; неизвестная дата asset не генерируется при каждом capture.

Резервные снимки — `<key>:snapshots`, до пяти; крупные предыдущие записи могут пропускаться (порог MAX_SNAPSHOT_BYTES=1500000 проверяется по длине строки). При quota предусмотрено освобождение старого backup и повтор записи. Journal ограничен 50 записями **в памяти**. Ошибки restore/recovery сообщаются; защищённый документ не должен автоматически перезаписываться. Это не облачная резервная копия.

Триггеры — rack mutations, change/history/transport events, flush при уходе; MutationObserver и периодическое сохранение неизменённого состояния не нужны. Completeness dirty tracking всё ещё проверяется M1.4.

Portable file: `kind: "sid-synth-bundle"`, `bundleVersion: 1`, savedAt, project, media (hash/name/mime/base64 data), optional mediaMissing. ProjectFiles проверяет song перед media import и хэши перед put. Raw project JSON также принимается без blobs. Download инициирует браузер, приложение не подтверждает физическую запись на диск.

## Правила изменения кода

- ES modules, 2 пробела, одинарные кавычки, точки с запятой; camelCase/PascalCase/UPPER_SNAKE по назначению. Комментарии — контракт и причина, не хроника номеров TODO.
- Одна ответственность модуля; не переносить god object целиком в «универсальный service». Не вводить Node для удобства одного теста.
- Snapshot getters не меняют музыку. На границах validation/normalization, копирование events/audio refs/порядка; никаких двух независимых канонических наборов нот.
- Правки проходят commands, один gesture — одна транзакция. Stable IDs вместо UI-индексов, UI не изменяет private engine fields.
- Audio scheduling по audio clock; таймер только наполняет горизонт. AudioParam задаётся на время ноты. Realtime/offline используют общие factories/conversions.
- Владелец освобождает nodes/timers/streams/listeners/observers/subscriptions. Delete/seek/Undo отменяют уже назначенные события. Не глотать ошибки сохранения/импорта/создания графа.
- DOM API и textContent для пользовательских имён; CSS classes/tokens, inline только динамическая геометрия. Подписки возвращают unsubscribe; shortcuts учитывают focus/input/contenteditable.
- Pixel/mono дисплеи и чёткие края совместимы с читаемым обычным текстом; UI-спецификация и приёмка собраны в M3, не считаются текущим дизайном.
- Рефакторинг структуры отделять от изменения музыкального поведения. Пользовательские изменения не перезаписывать, временные профили/backups не коммитить.
- После функции обновить USER_GUIDE, удалить принятый пункт TODO. Технические контракты править здесь; историю исправлений хранит Git, отдельные audit-документы не множить.

## Проверка без Node

Python 3.10+ stdlib и установленный Edge:

```powershell
python tests/run-browser-tests.py
python tests/run-browser-tests.py project-test project-validation-test projectSession-test rackProject-test
```

Путь браузера задаётся `--browser`, concurrency — `--jobs` (по умолчанию 1). Runner создаёт отдельные временные профили, использует fake media device и настоящий browser DOM/Web Audio. Ненулевой exit code, FAIL или незавершённый summary — неуспех. Модели используют mock clock/audio, часть звуковых тестов — OfflineAudioContext.

Legacy journey отдельно:

```powershell
python tests/run-browser-tests.py integration
```

Он очищает localStorage, поэтому не открывайте integration.html в профиле с рабочими песнями. Это обычный iframe-адаптер, не Playwright/Puppeteer.

Последний полный прогон после первого среза M3 (2026-09-13): **28 наборов, 969 passed, 0 failed**. App-test содержит 36 проверок, включая вкладки, сохранение идентичности панелей, реальную высоту dock, pause/resume, запрет Pause при MIDI-записи, границы keyboard-команд и ширины 390/683/1366/1920 px. Это не проверка реального zoom 200% или оборудования. Последний отдельный legacy journey до M3: **186 passed, 64 failed**; здесь повторно не запускался и в успешные 969 не включён. В M1.8 нужно разобрать каждое падение: ни «всё устарело», ни «всё сломано в приложении» пока не доказано.

Качество подтверждается musical events, Undo/snapshots, scheduled times и audio samples, а не числом кнопок. Изменения bootstrap проверяются реальным app-test. Fake device и mock не доказывают hardware latency, Firefox/Safari или работу больших проектов; выпускная матрица и stress — M7.

## История документации

Редакция сведена из двух audit-отчётов, ARCHITECTURE, UI_UX, PROJECT_SCHEMA, PROJECT_VALIDATION и CODING_STANDARDS. Они удалены из текущего дерева, а не из Git-истории; исходные версии доступны в коммите `96d7fb1`. Реализованные пользовательские сценарии перенесены в USER_GUIDE, все незавершённые обязательства — в TODO. Локальная main сверена с origin/main на начало редакции; поверх неё реализован первый срез M3, описанный в руководстве.
