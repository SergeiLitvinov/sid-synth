// Generic undo/redo command history. Commands are plain objects:
//   { label: string, apply(): void, undo(): void }
// apply() is re-run on redo, so it must be safe to call twice.
// createHistory is pure — no DOM, no AudioContext — so it can be unit-tested
// in the browser like the rest of the project modules.

export function createHistory({ onChange } = {}) {
  const undoStack = [];
  const redoStack = [];
  const subscribers = [];
  let cleanDepth = 0; // undoStack.length at last markSaved()
  let dirty = false;

  function state() {
    return {
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      dirty,
    };
  }

  function notify() {
    const s = state();
    if (onChange) onChange(s);
    subscribers.forEach(fn => fn(s));
  }

  function execute(command) {
    if (!command || typeof command.apply !== 'function') return false;
    command.apply();
    undoStack.push(command);
    redoStack.length = 0;
    dirty = undoStack.length !== cleanDepth;
    notify();
    return true;
  }

  function undo() {
    const command = undoStack.pop();
    if (!command) return false;
    command.undo();
    redoStack.push(command);
    dirty = undoStack.length !== cleanDepth;
    notify();
    return true;
  }

  function redo() {
    const command = redoStack.pop();
    if (!command) return false;
    command.apply();
    undoStack.push(command);
    dirty = undoStack.length !== cleanDepth;
    notify();
    return true;
  }

  // Record that the current state equals the saved-on-disk state.
  function markSaved() {
    cleanDepth = undoStack.length;
    dirty = false;
    notify();
  }

  function reset() {
    undoStack.length = 0;
    redoStack.length = 0;
    cleanDepth = 0;
    dirty = false;
    notify();
  }

  return {
    execute,
    undo,
    redo,
    markSaved,
    reset,
    state,
    onChange: (fn) => { onChange = fn; },
    subscribe: (fn) => { if (typeof fn === 'function') subscribers.push(fn); },
  };
}