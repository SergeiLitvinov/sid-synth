# SID Synth — Project Schema

Единый документ проекта объединяет modular rack, recorder tracks и настройки в
один versioned JSON. Цель — один источник правды: любой project файл проходит
`create → serialize → load → migrate` без потери данных (см. Definition of Done
в `TODO.md`).

Текущая версия схемы: **1**.

## Общие правила

- Все числа/значения сериализуемы в JSON (без `AudioNode`, функций, DOM-элементов).
- `schemaVersion` обязателен; `migrateProject()` поднимает версию, если нужно.
- `id` — строки; rack components и tracks используют стабильные id внутри проекта.
- Транзиентные поля (voice, element, observers, timer) никогда не попадают в документ.
- Неизвестные поля не разрушают загрузку: парсер игнорирует лишние ключи, но
  сохраняет их при round-trip не обязан.

## Сущности

| Сущность | Поле | Описание |
|---|---|---|
| `project` | `schemaVersion` | int, версия схемы (сейчас 1) |
| | `id` | string, стабильный UUID проекта |
| | `name` | string, название (default `Untitled`) |
| | `createdAt` / `modifiedAt` | string ISO-8601 |
| | `tempo` | number, BPM |
| | `rack` | объект — modular rack (`components`, `connections`) |
| | `tracks` | array — recorder tracks |
| | `activeTrackId` | string \| null, активный трек рекордера |
| `rack.components` | `id` | string, `type_N` (напр. `oscillator_1`) |
| | `type` | `oscillator` \| `filter` \| `adsr` \| `effects` \| `lfo` \| `mixer` \| `splitter` \| `sequencer` |
| | `x` / `y` | number, позиция в rack (px) |
| | `params` | object, параметры компонента (см. `captureParams`) |
| `rack.connections` | `from` | string, id источника |
| | `to` | string, id назначения или `master` |
| | `toChannel` | number \| null, канал входа (mixer) |
| | `outChannel` | number, канал выхода (splitter) |
| | `mod` | boolean, LFO-модуляция параметра (optional, default false) |
| `tracks[]` | `id` | string, `trk_N` |
| | `name` | string |
| | `color` | string hex |
| | `enabled` / `monitor` | boolean |
| | `muted` / `solo` | boolean (optional, default false) |
| | `height` | number px (optional, null = дефолт) |
| | `folder` | string \| null (optional, id трека-папки) |
| | `collapsed` | boolean (optional, default false) |
| | `wave` | string, waveform |
| | `filterType` / `filterFreq` / `filterQ` | filter config |
| | `adsr` | `{a, d, s, r}` |
| | `volume` | number 0..1 |
| | `gridNote` / `gridDur` | дефолт грида (note name / длительность в steps) |
| | `grid` | array[16] of `{note, dur}` \| null (пер-ячейковая высота/длительность) |
| | `rt` | array of `{note, start, dur}` realtime-события |

## Минимальный project JSON

```json
{
  "schemaVersion": 1,
  "id": "proj_abc123",
  "name": "Untitled",
  "createdAt": "2026-08-13T00:00:00.000Z",
  "modifiedAt": "2026-08-13T00:00:00.000Z",
  "tempo": 120,
  "rack": {
    "components": [
      {
        "id": "oscillator_1",
        "type": "oscillator",
        "x": 100,
        "y": 40,
        "params": { "wave": "square", "freq": 110, "on": true, "n": 1 }
      },
      {
        "id": "filter_1",
        "type": "filter",
        "x": 280,
        "y": 40,
        "params": { "type": "lowpass", "freq": 1200, "q": 1 }
      }
    ],
    "connections": [
      { "from": "oscillator_1", "to": "filter_1", "toChannel": null, "outChannel": 0 }
    ]
  },
  "tracks": [
    {
      "id": "trk_1",
      "name": "Track 1",
      "color": "#4af74a",
      "enabled": true,
      "monitor": true,
      "wave": "square",
      "filterType": "none",
      "filterFreq": 1200,
      "filterQ": 1,
      "adsr": { "a": 0.01, "d": 0.1, "s": 0.7, "r": 0.1 },
      "volume": 0.85,
      "gridNote": "C4",
      "gridDur": 1,
      "grid": [
        { "note": "C4", "dur": 1 },
        null,
        { "note": "E4", "dur": 2 },
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ],
      "rt": []
    }
  ],
  "activeTrackId": "trk_1"
}
```

## Миграции

- `fromLegacy({ autosave, tracksStore })` — собирает проект из старых ключей
  localStorage (`sidSynthAutosave` → `rack`, `sidSynthTracks` → `tracks`/`tempo`),
  генерирует `id` и timestamp. Пустые части (нет autosave) → пустой rack.
- `migrateProject(project)` — если `schemaVersion < 1` или отсутствует — добавляет
  недостающие поля до версии 1. Версии > текущей считаются ошибкой (нельзя
  понизить схему).

## Персистенция (`src/project/projectStore.js`)

- `createProjectStore({ storage, storageKey, autosaveKey, tracksKey, debounceMs, capture, apply })`
  сохраняет весь project snapshot в **один ключ** `sidSynthProject` (debounce 600мс).
  `capture`/`apply` инжектируются из `main.js`, поэтому модуль не зависит от DOM.
- API: `saveNow`, `save` (debounced), `markDirty`, `restore`, `readRaw`, `readProject`, `clear`.
- `restore()`: читает `sidSynthProject`; при отсутствии/ошибке мигрирует legacy-ключи
  через `fromLegacy`, пишет мигрированный документ обратно в `sidSynthProject` и
  **удаляет** `sidSynthAutosave`/`sidSynthTracks`. Новый ключ имеет приоритет.
- Триггеры сохранения (в `main.js`): MutationObserver на рэке, `change`-событие,
  `history.subscribe(...)`, safety-interval 3с.

## Round-trip

`serialize` + `parse` должны возвращать структурно идентичный документ
(сравнение по `JSON.stringify` после нормализации). Тест: `tests/project-test.html/js`.