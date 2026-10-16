// src/lib/stores/modalStack.ts

/** Handlers a dialog registers while it's open; only the topmost registered dialog receives keys. */
export type ModalHandlers = {
  onEscape?: () => void;
  onEnter?: () => void;
  /** Mirrors the dialog's own primary-button `disabled` condition; Enter no-ops when this returns true. */
  enterDisabled?: () => boolean;
};

const stack: ModalHandlers[] = [];

/** Registers a dialog's handlers on mount. Returns an unregister function — call it on destroy. */
export function pushModal(handlers: ModalHandlers): () => void {
  stack.push(handlers);
  return () => {
    const i = stack.indexOf(handlers);
    if (i !== -1) stack.splice(i, 1);
  };
}

/** True while at least one dialog is registered — gates the global shortcut dispatcher. */
export function isModalOpen(): boolean {
  return stack.length > 0;
}

/** Wired once to the app's window keydown listener (`+layout.svelte`, Slice 2). */
export function handleModalKeydown(e: KeyboardEvent): void {
  if (stack.length === 0) return;
  const top = stack[stack.length - 1];
  if (e.key === "Escape") {
    top.onEscape?.();
  } else if (e.key === "Enter") {
    const target = e.target as { tagName?: string } | null;
    if (target?.tagName === "TEXTAREA") return;
    if (top.enterDisabled?.()) return;
    top.onEnter?.();
  }
}
