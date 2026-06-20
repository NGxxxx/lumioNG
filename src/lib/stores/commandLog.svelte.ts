export interface LogEntry {
  n: number;
  text: string;
}

/** Command log mongosh (chỉ-đọc): mỗi thao tác đẩy một dòng. Giới hạn N mục gần nhất. */
export function createCommandLog(limit = 500) {
  let entries = $state<LogEntry[]>([]);
  let open = $state(true);
  let counter = 0;

  function push(text: string) {
    counter += 1;
    const next = [...entries, { n: counter, text }];
    entries = next.length > limit ? next.slice(next.length - limit) : next;
  }

  function clear() {
    entries = [];
  }

  function toggle() {
    open = !open;
  }

  return {
    get entries() {
      return entries;
    },
    get open() {
      return open;
    },
    push,
    clear,
    toggle,
  };
}

/** Singleton dùng trong app (test tự tạo instance riêng qua createCommandLog). */
export const commandLog = createCommandLog();
