// Standalone editors retain their legacy shortcut contract. In a composed
// workspace only the focused editor may handle musical editing shortcuts.
export function acceptsEditorShortcut(container, event) {
  if (event.defaultPrevented || container.closest('[hidden]')) return false;
  if (event.target?.closest?.('input, select, textarea, [contenteditable="true"], [role="tab"]')) return false;
  const scope = container.closest('[data-shortcut-scope]');
  if (!scope) return true;
  return scope.contains(event.target);
}
