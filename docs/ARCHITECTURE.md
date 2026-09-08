# Архитектура и границы модулей

Аудит 2026-09-07. Текущее приложение — ES modules без сборщика. Главная проблема масштабирования: количество обязанностей редакторов и движка растёт быстрее их публичных контрактов. Размер файла — сигнал для проверки, но не самостоятельный критерий качества.

## Что разделено в этом аудите

| Модуль | Ответственность |
|---|---|
| main.js, 251 строка | Создать audio context и связать домены приложения |
| rack/rackController.js | Rack UI, создание модулей, кабели, клавиши и patch/preset actions |
| project/projectSession.js | Снять и применить единый project snapshot через переданные зависимости |
| tracks/liveInput.js | Выбрать получателей note-on и сохранить их до note-off; monitor и capture |
| project/stepEditing.js | Чистая точечная правка события шага без потери других нот/аккордов |
| project/projectStore.js | Хранение и миграция, защита существующего проекта при ошибке чтения/записи |

Rack controller ещё содержит разные виды взаимодействий внутри одного домена; следующий шаг — отделить gestures и note runtime. Project session координирует текущие движки, но не превращает приложение в immutable state store автоматически.

## Где остаётся концентрация обязанностей

| Файл | Строки после аудита | Обязанности, которые нужно разделить |
|---|---:|---|
| arranger/pianoRoll.js | 1243 | Notes, velocity, gestures, selection, transforms, step typing, drum view, audio inspector |
| arranger/arranger.js | 977 | Timeline, ruler, headers, markers, viewport, selection и edit gestures |
| tracks/trackEngine.js | 1037 | Track model, clip edits, scheduler, record buffer, routing, audio playback |
| tracks/recorderUI.js | 617 | Transport, track rows, grid, MIDI device list, inserts, export |
| audio/inputUI.js | 534 | Device lifecycle, monitor, meter, capture, latency, count-in, punch, asset placement |

God object возникает, когда изменение одной функции требует знания всего перечисленного. Например, адаптер ранее повторял engine.record и потерял REPLACE; main обходил note API и получил MIDI-сбой; getTracks изменял clip.events и терял музыкальные данные при обычном чтении.

## Целевое направление зависимостей

UI → actions/commands → project/track/clip state → scheduler/device runtime. Persistence читает serializable state. UI получает snapshots и события, а не изменяемые AudioNode. Layout и музыкальные преобразования остаются чистыми функциями. Bootstrap связывает сервисы, не реализует их бизнес-логику.

Разделять по поведению, не делать одну универсальную services-папку для всей DAW:

- project: schema, normalization/migration, history, session, persistence;
- transport: musical clock, tempo/signature map, seek/loop policy, scheduling windows;
- tracks: repository, audibility и device chain; instrument/audio/bus — явные типы;
- clips: source/events, недеструктивные edits и commands;
- recording: live notes, takes, capture lifecycle и placement;
- arranger/editors: view/layout, gestures и selection отдельно;
- audio/devices: DOM-free graph factories и processor lifecycle;
- app: composition, actions/shortcuts и project switching.

Это предлагаемые границы, а не требование немедленно создать все каталоги. Сначала перенести одну обязанность с тестами, затем убрать старый путь.

## Правила контрактов

1. Чтение snapshots не должно менять музыку. Event data копируются глубоко; runtime scheduling pointers не являются проектными данными.
2. Единственная операция prepareRecording используется и автономным engine, и transport adapter; нельзя поддерживать две расходящиеся копии алгоритма.
3. Note-on/note-off проходят общий API. Note-off относится к исходному получателю, даже если изменилось выделение или arm.
4. UI подписывается с unsubscribe; не переписывает onTick и не подменяет engine.addTrack. Один владелец ресурса отвечает за dispose.
5. Команды адресуют объекты стабильным ID. Одна gesture — одна транзакция; undo восстанавливает все данные и порядок, а не только видимые поля.
6. Данные проекта валидируются до удаления текущего графа; ошибки хранения нельзя глотать и трактовать как успех.
7. Unit tests проверяют чистые модели, integration — границы доменов, real audio — результат DSP. Число тестов само по себе не означает готовность DAW.

## Последовательность без большого переписывания

Явное song/pattern playback и точечные step edits введены. Следующий срез — завершить каноническую MIDI-модель, удалив дублирование grid/rt/clip, затем вынести scheduler/recording contracts и subscriptions. После этого — commands/selection/gestures редакторов и новый workspace, использующий те же действия. Mixer, automation и offline render строятся поверх этих контрактов.

### Выбор step-клипа

`tracks/clipSelection.js` хранит сессионный выбор по track/clip ID и строит проекцию первых 16 шагов из событий. Выбор не меняет legacy grid/rt или звук. Engine предоставляет getStepClip/getStepGrid/selectStepClip; recorder и arranger используют этот контракт. Выбор пока не сохраняется в проект и не управляет целью записи/PATTERN. При отсутствии выбранного ID используется клип на нуле либо первый доступный. Команды шагов и CLR хранят полные before/after снимки, чтобы redo не зависел от текущего выбора; это временный механизм до granular clip commands.
