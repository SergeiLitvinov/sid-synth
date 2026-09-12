# SID Studio / SID Synth

Развивающаяся web-DAW на Web Audio API с модульным SID-вдохновлённым синтезатором и 8-битной эстетикой. Есть мультитрековый recorder, arranger, piano roll/drum editor, импорт и запись аудио, delay/reverb inserts и базовый realtime WAV bounce.

## Документация

- [Руководство пользователя](docs/USER_GUIDE.md) — запуск, мелодии, треки, клипы, MIDI, audio recording, rack, сохранение и ограничения.
- [TODO](docs/TODO.md) — только оставшиеся задачи до полноценной DAW.
- [Аудит реализации](docs/AUDIT.md) — исправления и результаты проверок 2026-09-07.
- [Архитектура](docs/ARCHITECTURE.md) — границы модулей и план устранения god objects.
- [UI/UX](docs/UI_UX.md) — спецификация современного 8-битного рабочего пространства.
- [Формат проекта](docs/PROJECT_SCHEMA.md) и [стандарты кода](docs/CODING_STANDARDS.md).

## Запуск

Приложение работает как статический сайт, без npm и сборки. Из каталога проекта:

```powershell
python serve.py . 3000
```

Откройте [localhost:3000](http://localhost:3000). Если Python отсутствует, используйте PowerShell 7:

```powershell
pwsh -File tests/serve-ps.ps1
```

Тогда адрес — [localhost:3100](http://localhost:3100). Серверы отключают HTTP cache. Web Audio требует действия пользователя, запись входа — разрешения браузера. Поддержку Web MIDI/AudioWorklet/декодеров проверяйте в используемом браузере: полной подтверждённой cross-browser matrix пока нет.

## Текущие границы

В RECORDER доступны SONG и PATTERN. Новые проекты используют SONG: все MIDI-клипы, включая клипы в позиции 0, играют один раз в своих границах. PATTERN сохраняет прежний повтор первой 16-шаговой сетки; проекты без сохранённого режима открываются в PATTERN. Есть track mute/solo и inserts, но нет полноценной консоли с шинами/sends/automation. Классический rack монофонический, синтезаторы треков — восьмиголосные.

Autosave проекта хранится локально в localStorage, аудио — в IndexedDB того же origin. SAVE PATCH сохраняет только rack. NEW / OPEN / SAVE / SAVE AS переносят всю песню с аудио одним `.sidproject.json` (проверен переносом в чистый профиль). WAV записывает четыре такта живого master в 16-bit stereo; offline render всей песни и stems пока отсутствуют.

## Структура

- src/main.js — сборка приложения.
- src/rack/ — управление модульным рэком.
- src/project/ — project model, history, persistence, musical time/transport.
- src/tracks/ — track/voice engine, live note routing, recorder UI и inserts.
- src/arranger/ — timeline, piano roll/drum editing и чистые note transforms.
- src/audio/ — assets, import, capture, playback и waveform.
- src/components/ и audio-модули — rack UI и synthesis.
- tests/ — браузерные наборы и интеграционные проверки.

## Проверка

```powershell
python tests/run-browser-tests.py
```

Runner использует установленный Edge и Python stdlib, отдельные временные профили и искусственный вход аудио. Другой путь к Edge передаётся через --browser. Для отдельного набора: python tests/run-browser-tests.py audit-test. Страницы tests/*-test.html можно открыть вручную на локальном сервере; audioInput-test требует доступного тестового входа.

Результаты последнего аудита и границы тестирования — в [AUDIT.md](docs/AUDIT.md). Отдельный tests/integration.js требует внешнего Playwright harness и не включён автоматически в Python runner.

## Лицензия

MIT. Вдохновлено Commodore 64 / MOS SID; точность аппаратной эмуляции не заявляется.
