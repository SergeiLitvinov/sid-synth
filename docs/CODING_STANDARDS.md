# SID Synth — Стандарты кодирования

## JS / ES Modules

- ES Modules (`import`/`export`) по всему проекту; без глобальных переменных и `window`-полей в модулях.
- Отступы: 2 пробела; одинарные кавычки; точка с запятой обязательна.
- Именование:
  - `camelCase` — переменные и функции
  - `PascalCase` — классы и конструкторы
  - `UPPER_SNAKE` — константы (например, `NOTES`, `PRESETS`)
- Файл — один публичный экспорт по умолчанию (класс или фабрика), внутренние хелперы — локальные функции.
- Без мёртвых `console.log`; `console.error` — только для реальных ошибок.
- Комментарии — на английском, только там, где логика неочевидна. Без шумных секций.

## Структура кода

- `main.js` должна оставаться тонкой (цель <300 строк). Домены выносить в `src/services/*`:
  роутер соединений, drag&drop, пресеты, MIDI, визуализация.
- Избегать размножения `switch`-блоков: при создании аудио-нод использовать реестр/мапу
  (см. `src/oscillator/index.js` → `create()`), а не дублировать `switch` в компонентах.
- Баррель-файлы `index.js` в каждой папке — единая точка экспорта домена.

## Компоненты (UI + audio)

- Всё наследуется от `AudioComponent` (`src/components/AudioComponent.js`).
- Контракт компонента:
  - `inputGain` / `outputGain` (`GainNode`) — точки подключения для роутера
  - `update()` — пересборка/применение параметров
  - `dispose()` — полное освобождение: отписка слушателей, `disconnect()` всех нод
  - `type` — строковый идентификатор типа
- Параметры компонента — единственный источник правды (состояние UI читать из свойств).

## Web Audio API

- Каждый `connect()` симметрично уравновешен `disconnect()` (в `update()`/`dispose()`).
- Не пересоздавать `AudioNode` ради смены значения — менять `AudioParam.value`
  (например, `osc.frequency.value`, `filter.frequency.value`).
- Держать ссылки на `AudioParam` (или ноду), не обращаться по строковым именам.
- Всё, что может бросить исключение (stop, disconnect), оборачивать в `try/catch`.
- Тайминговые события планировать через `ctx.currentTime`, а не только `setTimeout`.
- Соблюдать баланс: Dolby нет, но умножение ведёт к клиппингу — контролировать уровни `GainNode`.

## DOM и стили

- Элементы создавать программно (`document.createElement`), инлайн-HTML в JS запрещён.
- Инлайн-стили в JS — только исключительные случаи; основной стиль — в `.css` через классы.
- Слушатели, добавленные на `document`/`window`, обязательно снимать в `dispose()`,
  иначе — утечки при удалении компонента.
- CSS-цвета только валидные (6 hex-символов или `hsl()/rgba()`); без дублей правил.

## Git

- Атомарные коммиты с префиксами: `fix:`, `feat:`, `refactor:`, `docs:`, `chore:`.
- Не коммитить бэкапы (`*.bak`, `*.old`), временные артефакты, «обфускаторы» — они в `.gitignore`.
- Не мешать в один коммит рефакторинг и фиксы поведения.

## Проверка перед сдачей

- Без внешних зависимостей и Node — проект не требует `node_modules`/npm.
- Сервер: `.\serve.ps1` (порт 3000, через `serve.py`) или `pwsh -File tests/serve-ps.ps1` (порт 3100, только PS7) — оба без кэша.
- Браузерные тесты: `.\serve.ps1` → `http://localhost:3000/tests/smoke.html` (10/10),
  `http://localhost:3000/tests/mock-test.html` (11/11),
  `http://localhost:3000/tests/track-test.html` (112/112),  `http://localhost:3000/tests/project-test.html` (38/38),
  `http://localhost:3000/tests/history-test.html` (28/28),
  `http://localhost:3000/tests/recorderUI-test.html` (27/27),
  `http://localhost:3000/tests/musicalTime-test.html` (26/26),
  `http://localhost:3000/tests/transport-test.html` (48/48),
  `http://localhost:3000/tests/projectStore-test.html` (11/11, async debounce-тест требует Playwright/ожидания),
  `http://localhost:3000/tests/clipEvents-test.html` (21/21),
  `http://localhost:3000/tests/wavExport-test.html` (8/8) и
  `http://localhost:3000/tests/arranger-test.html` (207/207) — без FAIL (итого 509/509).
- E2E: `tests/integration.js` (225 шагов, 7 новых в r30 — drum editor; проверка в браузере потребуется при восстановлении Playwright MCP) гоняется браузерным харнессом (Playwright MCP)
  против живого приложения (порт 3000 или 3100) — без FAIL.
- Юнит-тесты гоняются Edge headless `--dump-dom` с уникальным `--user-data-dir` на страницу
  (общий профиль даёт ложные фейлы — известный флак); ожидание `SUMMARY:` в DOM.
- После правок исходников прогонять наборы с отключённым HTTP-кэшем браузера
  (CDP `Network.setCacheDisabled`) — иначе устаревший модуль даёт фантомные падения.
- Ручной smoke-тест: сервер (3000/3100) → проверить создание компонента, соединение
  к MASTER OUT, звук клавишей, сохранение/загрузку патча.