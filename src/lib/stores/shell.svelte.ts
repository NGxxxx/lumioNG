import { namespaceTree as defaultTree } from "./namespaceTree.svelte";

type TreeLike = { readonly databases: { name: string; collections: string[] }[] };

/** State của "vỏ" (chrome): connection hiện tại, kích thước sidebar/log, đếm db/collection. */
export function createShell(tree: TreeLike = defaultTree) {
  let connection = $state<{ label: string; uri: string } | null>(null);
  let sessionOpen = $state(true);
  let sidebarWidth = $state(240);
  let logOpen = $state(true);
  let logHeight = $state(140);

  const dbCount = $derived(tree.databases.length);
  const collCount = $derived(tree.databases.reduce((n, d) => n + d.collections.length, 0));

  function setConnection(c: { label: string; uri: string } | null) {
    connection = c;
  }
  function toggleSession() {
    sessionOpen = !sessionOpen;
  }
  function toggleLog() {
    logOpen = !logOpen;
  }
  function setSidebarWidth(w: number) {
    sidebarWidth = Math.max(160, Math.min(600, Math.round(w)));
  }
  function setLogHeight(h: number) {
    logHeight = Math.max(60, Math.min(500, Math.round(h)));
  }

  return {
    get connection() {
      return connection;
    },
    get sessionOpen() {
      return sessionOpen;
    },
    get sidebarWidth() {
      return sidebarWidth;
    },
    get logOpen() {
      return logOpen;
    },
    get logHeight() {
      return logHeight;
    },
    get dbCount() {
      return dbCount;
    },
    get collCount() {
      return collCount;
    },
    setConnection,
    toggleSession,
    toggleLog,
    setSidebarWidth,
    setLogHeight,
  };
}

/** Singleton dùng trong app (test tự tạo instance riêng qua createShell). */
export const shell = createShell();
