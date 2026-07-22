export type ToastKind = "success" | "error";
type ToastEntry = { id: number; message: string; kind: ToastKind };

const DEFAULT_DURATION_MS = 2500;

function createToastStore() {
  let toasts = $state<ToastEntry[]>([]);
  let nextId = 0;

  function push(message: string, kind: ToastKind = "success", durationMs = DEFAULT_DURATION_MS) {
    const id = nextId++;
    toasts = [...toasts, { id, message, kind }];
    setTimeout(() => dismiss(id), durationMs);
  }

  function dismiss(id: number) {
    toasts = toasts.filter((t) => t.id !== id);
  }

  return {
    get toasts() { return toasts; },
    push,
    dismiss,
  };
}

/** App-wide singleton, rendered once by ToastHost.svelte. */
export const toast = createToastStore();
