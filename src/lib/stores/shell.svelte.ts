import { namespaceTree as defaultTree } from "./namespaceTree.svelte";

type TreeLike = { readonly databases: { name: string; collections: string[] }[] };

/** App chrome state: active connection, sidebar/log dimensions, and db/collection counts. */
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
  function openSession() {
    sessionOpen = true;
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
    openSession,
    toggleLog,
    setSidebarWidth,
    setLogHeight,
  };
}

/** App-wide singleton (tests create their own instance via createShell). */
export const shell = createShell();
