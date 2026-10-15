export type ToastKind = "success" | "error";
export type ToastAction = { label: string; run: () => void };
type ToastEntry = { id: number; message: string; kind: ToastKind; action?: ToastAction };

const DEFAULT_DURATION_MS = 2500;

function createToastStore() {
  let toasts = $state<ToastEntry[]>([]);
  let nextId = 0;

  /** Shows a toast; with an `action` it renders a button (e.g. "Undo"). Returns the toast id. */
  function push(message: string, kind: ToastKind = "success", durationMs = DEFAULT_DURATION_MS, action?: ToastAction): number {
    const id = nextId++;
    toasts = [...toasts, { id, message, kind, action }];
    setTimeout(() => dismiss(id), durationMs);
    return id;
  }

  /** Runs a toast's action and dismisses it. */
  function runAction(id: number) {
    const t = toasts.find((x) => x.id === id);
    dismiss(id);
    t?.action?.run();
  }

  function dismiss(id: number) {
    toasts = toasts.filter((t) => t.id !== id);
  }

  return {
    get toasts() { return toasts; },
    push,
    dismiss,
    runAction,
  };
}

/** App-wide singleton, rendered once by ToastHost.svelte. */
export const toast = createToastStore();
