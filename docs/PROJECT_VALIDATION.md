# Project validation and replacement

Implementation: 2026-09-13, based on main `132f559` (portable bundle and revision autosave).

## Input policy

`parseProject` validates supplied values before normalization, clones the input, fills missing fields, and validates the resulting document. It does not modify or share nested objects with its caller. Errors include the field path.

- Schema and bundle version must be supported integers. Missing project schema is the supported unversioned legacy input; explicit 0, negative, fractional, string, null and future versions are rejected. Bundle version is required and must equal 1.
- All numeric fields, including extension data, must be finite. Tempo is 1–1000 BPM; clip/event lengths are positive, positions and offsets nonnegative, loop end exceeds loop start. MIDI notes cover 0–127; velocity 0–127, channel 0–15, bend −1–1, modulation/pressure 0–1.
- Track volume and sustain are 0–1; gains/fades/ADSR times cannot be negative. Insert delay is 0–2 seconds, feedback/mix 0–1. Rack controls use their supported ranges; oscillator frequency accepts positive values up to 20 kHz, including MIDI-driven pitches beyond its knob's displayed range. Only implemented rack/insert types are accepted.
- IDs are unique within tracks, clips, events (when present), markers, routes (when present), and asset hashes. Rack and insert devices share an ID namespace. Reserved object keys are rejected.
- Active track and folder references must exist; folder cycles are rejected. Rack endpoints and channel ports are checked; duplicate routes are rejected. Audio clip hashes must exist in the asset manifest. A missing Blob is still reported by bundle/media handling, not treated as a malformed manifest reference.
- `event.device` is recorded external MIDI-device provenance, not a project device reference: opening a song does not require the physical MIDI device to be connected.
- Missing optional fields still get defaults; malformed supplied fields do not. Legacy grid/rt are checked and folded into clips by migration/normalization. Persistent generation of missing event/route IDs remains the next TODO block.

## Replacement lifecycle

`createProjectSession.prepareProject` validates and copies the document, prepares a detached muted rack and constructs new track voices without publishing them. Allocation tracking releases partial AudioNodes even if a constructor throws before returning its component. Failed preparation disposes the staged graph and leaves live tracks, rack, selection, locators, assets and history intact.

`commit` synchronously adopts prepared tracks and rack, sets metadata/locators, resets history and publishes the complete track state. No asset reads, promises or device construction occur after replacement begins. Rack master routing retains the actual staged bus as its destination so deleting a loaded connection disconnects its audio path. Disposed/committed session preparations cannot be committed again.

Store restore reports an apply failure and blocks overwriting the saved document. Recovery skips invalid backups. Save rejects invalid captures before JSON can convert nonfinite numbers to null. Bundle import validates the song before writing media.

## Verification

Run the reproducible DOM-free model checks with Node (tested on Node 24):

```sh
node tests/run-model-tests.mjs
```

375/375 pass: project 95, projectStore 22, projectSession 11, audit 16, track 161, song 21, history 28, clipEvents 21.

`rackProject-test` additionally passes 5/5 with a temporary minimal DOM harness and the existing mock AudioContext: detached preparation, pitch preservation, master disconnect, failed constructor cleanup and LFO waveform restoration. This is not a real browser test.

Browser suite entry points are `tests/projectSession-test.html` and `tests/rackProject-test.html`; both are automatically included by the existing Python browser runner. With Edge/Chrome installed:

```sh
python tests/run-browser-tests.py --browser /path/to/browser
```

The full browser/UI/real-Web-Audio run is outstanding. This environment has no browser executable and Chromium installation failed with network timeouts. An exploratory Node run of the unchanged transport browser suite reports 55/56 (the pause/resume test compares an exact wall-clock tick position); it is not included in the DOM-free runner and no transport changes are made here. The TODO remains unchecked until the browser gate passes, including repeated Open/New, failed import while playing, media transfer and audio routing after loading.
