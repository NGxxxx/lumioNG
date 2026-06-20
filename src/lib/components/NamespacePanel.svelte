<script lang="ts">
  import { namespaceTree } from "../stores/namespaceTree.svelte";
  import NamespaceTree, { type TreeMenuTarget } from "./NamespaceTree.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import NameDialog from "./NameDialog.svelte";
  import NewDatabaseDialog from "./NewDatabaseDialog.svelte";
  import DropConfirmDialog from "./DropConfirmDialog.svelte";

  let {
    connection = null,
    onselect,
    onselectdb,
    onopenindexes,
    onopeninfo,
    onopendbstats,
  }: {
    connection?: { label: string } | null;
    onselect?: (d: { db: string; coll: string }) => void;
    onselectdb?: (d: { db: string }) => void;
    onopenindexes?: (d: { db: string; coll: string }) => void;
    onopeninfo?: (d: { db: string; coll: string }) => void;
    onopendbstats?: (d: { db: string }) => void;
  } = $props();

  let menu = $state<TreeMenuTarget | null>(null);
  type Dialog =
    | { type: "newDb" }
    | { type: "newColl"; db: string }
    | { type: "rename"; db: string; coll: string }
    | { type: "dropColl"; db: string; coll: string }
    | { type: "dropDb"; db: string };
  let dialog = $state<Dialog | null>(null);

  const dbItems = [
    { label: "New collection", action: "newColl" },
    { label: "Stats", action: "stats" },
    { label: "Drop database", action: "dropDb" },
  ];
  const collItems = [
    { label: "Info", action: "info" },
    { label: "Indexes", action: "indexes" },
    { label: "Rename collection", action: "rename" },
    { label: "Drop collection", action: "dropColl" },
  ];

  function onMenuSelect(action: string) {
    const m = menu;
    menu = null;
    if (!m) return;
    if (m.kind === "db") {
      if (action === "newColl") dialog = { type: "newColl", db: m.db };
      else if (action === "stats") onopendbstats?.({ db: m.db });
      else if (action === "dropDb") dialog = { type: "dropDb", db: m.db };
    } else {
      if (action === "info") onopeninfo?.({ db: m.db, coll: m.coll });
      else if (action === "indexes") onopenindexes?.({ db: m.db, coll: m.coll });
      else if (action === "rename") dialog = { type: "rename", db: m.db, coll: m.coll };
      else if (action === "dropColl") dialog = { type: "dropColl", db: m.db, coll: m.coll };
    }
  }
</script>

{#if namespaceTree.error}<div class="error">{namespaceTree.error}</div>{/if}

<NamespaceTree
  databases={namespaceTree.databases}
  {connection}
  {onselect}
  {onselectdb}
  onnewdatabase={() => (dialog = { type: "newDb" })}
  onmenu={(t) => (menu = t)}
/>

{#if menu}
  <ContextMenu
    x={menu.x}
    y={menu.y}
    items={menu.kind === "db" ? dbItems : collItems}
    onselect={onMenuSelect}
    onclose={() => (menu = null)}
  />
{/if}

{#if dialog?.type === "newDb"}
  <NewDatabaseDialog
    onsubmit={async (db, coll) => {
      await namespaceTree.createDatabase(db, coll);
      dialog = null;
    }}
    oncancel={() => (dialog = null)}
  />
{:else if dialog?.type === "newColl"}
  {@const d = dialog}
  <NameDialog
    title="New collection"
    label="Tên collection"
    onsubmit={async (name) => {
      await namespaceTree.createCollection(d.db, name);
      dialog = null;
    }}
    oncancel={() => (dialog = null)}
  />
{:else if dialog?.type === "rename"}
  {@const d = dialog}
  <NameDialog
    title="Rename collection"
    label="Tên mới"
    initial={d.coll}
    onsubmit={async (name) => {
      await namespaceTree.renameCollection(d.db, d.coll, name);
      dialog = null;
    }}
    oncancel={() => (dialog = null)}
  />
{:else if dialog?.type === "dropColl"}
  {@const d = dialog}
  <DropConfirmDialog
    title="Drop collection"
    message={`Xóa collection "${d.coll}" trong "${d.db}"? Không hoàn tác.`}
    expectedName={d.coll}
    onconfirm={async () => {
      await namespaceTree.dropCollection(d.db, d.coll);
      dialog = null;
    }}
    oncancel={() => (dialog = null)}
  />
{:else if dialog?.type === "dropDb"}
  {@const d = dialog}
  <DropConfirmDialog
    title="Drop database"
    message={`Xóa database "${d.db}" và toàn bộ collection bên trong? Không hoàn tác.`}
    expectedName={d.db}
    onconfirm={async () => {
      await namespaceTree.dropDatabase(d.db);
      dialog = null;
    }}
    oncancel={() => (dialog = null)}
  />
{/if}

<style>
  .error { background: #fdecea; color: #b71c1c; padding: 6px 10px; font-size: 12px; }
</style>
