<script lang="ts">
  import { namespaceTree } from "../stores/namespaceTree.svelte";
  import NamespaceTree, { type TreeMenuTarget } from "./NamespaceTree.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import NameDialog from "./NameDialog.svelte";
  import NewDatabaseDialog from "./NewDatabaseDialog.svelte";
  import DropConfirmDialog from "./DropConfirmDialog.svelte";
  import ExportDialog from "./ExportDialog.svelte";
  import { saveDialog, openDialog, writeTextFile } from "../api/files";
  import { exportQuery, exportBson, importDocuments, importBson } from "../api/documents";
  import { toJsonArray, toCsv } from "../domain/exporter";
  import { findCmd, importCmd, exportBsonCmd } from "../domain/mongosh";
  import { commandLog } from "../stores/commandLog.svelte";
  import { errorMessage } from "../api/errors";

  let {
    connection = null,
    onselect,
    onselectdb,
    onnewquery,
    onmanagesessions,
    ondisconnect,
  }: {
    connection?: { label: string } | null;
    onselect?: (d: { db: string; coll: string }) => void;
    onselectdb?: (d: { db: string }) => void;
    onnewquery?: (d: { db: string; coll: string }) => void;
    onmanagesessions?: () => void;
    ondisconnect?: () => void;
  } = $props();

  let menu = $state<TreeMenuTarget | null>(null);

  type Dialog =
    | { type: "newDb" }
    | { type: "newColl"; db: string }
    | { type: "rename"; db: string; coll: string }
    | { type: "dropColl"; db: string; coll: string }
    | { type: "dropDb"; db: string }
    | { type: "truncate"; db: string; coll: string }
    | { type: "export"; db: string; coll: string };

  let dialog = $state<Dialog | null>(null);
  let io = $state<string | null>(null);
  let ioErr = $state<string | null>(null);

  const connItems = [
    { label: "New database…", action: "newDb" },
    { label: "Refresh", action: "refresh" },
    { label: "Manage sessions…", action: "manageSessions" },
    { label: "Disconnect", action: "disconnect" },
  ];
  const dbItems = [
    { label: "New collection…", action: "newColl" },
    { label: "Copy name", action: "copyName" },
    { label: "Refresh", action: "refresh" },
    { label: "Drop database…", action: "dropDb" },
  ];
  const collItems = [
    { label: "New aggregate…", action: "newQuery" },
    { label: "Export…", action: "export" },
    { label: "Import…", action: "import" },
    { label: "Copy name", action: "copyName" },
    { label: "Rename collection…", action: "rename" },
    { label: "Truncate…", action: "truncate" },
    { label: "Drop collection…", action: "dropColl" },
  ];

  function onMenuSelect(action: string) {
    const m = menu;
    menu = null;
    if (!m) return;
    if (m.kind === "conn") {
      if (action === "newDb") dialog = { type: "newDb" };
      else if (action === "refresh") namespaceTree.refresh();
      else if (action === "manageSessions") onmanagesessions?.();
      else if (action === "disconnect") ondisconnect?.();
    } else if (m.kind === "db") {
      if (action === "newColl") dialog = { type: "newColl", db: m.db };
      else if (action === "copyName") navigator.clipboard.writeText(m.db);
      else if (action === "refresh") namespaceTree.refresh();
      else if (action === "dropDb") dialog = { type: "dropDb", db: m.db };
    } else {
      if (action === "newQuery") onnewquery?.({ db: m.db, coll: m.coll });
      else if (action === "export") dialog = { type: "export", db: m.db, coll: m.coll };
      else if (action === "import") runImport(m.db, m.coll);
      else if (action === "copyName") navigator.clipboard.writeText(`${m.db}.${m.coll}`);
      else if (action === "rename") dialog = { type: "rename", db: m.db, coll: m.coll };
      else if (action === "truncate") dialog = { type: "truncate", db: m.db, coll: m.coll };
      else if (action === "dropColl") dialog = { type: "dropColl", db: m.db, coll: m.coll };
    }
  }

  async function runExportCollection(db: string, coll: string, format: "json" | "csv" | "bson") {
    const ext = format;
    const path = await saveDialog(`${coll}.${ext}`, [{ name: ext.toUpperCase(), extensions: [ext] }]);
    if (path === null) return;
    io = null; ioErr = null;
    try {
      if (format === "bson") {
        const n = await exportBson(db, coll, "{}", null, null, path);
        io = `Đã export ${n} document.`;
        commandLog.push(exportBsonCmd(db, coll, path));
      } else {
        const data = await exportQuery(db, coll, "{}", null, null);
        await writeTextFile(path, format === "json" ? toJsonArray(data) : toCsv(data));
        io = `Đã export ${data.length} document.`;
        commandLog.push(findCmd({ coll, filter: "{}" }));
      }
    } catch (e) { ioErr = errorMessage(e); }
  }

  async function runImport(db: string, coll: string) {
    const path = await openDialog([{ name: "JSON / JSONL / BSON", extensions: ["json", "jsonl", "bson"] }]);
    if (path === null) return;
    io = null; ioErr = null;
    try {
      const res = path.toLowerCase().endsWith(".bson")
        ? await importBson(db, coll, path)
        : await importDocuments(db, coll, path);
      commandLog.push(importCmd(db, coll, path));
      const detail = res.errors.length ? ` ${res.errors.join("; ")}` : "";
      io = `Đã chèn ${res.inserted}, bỏ qua ${res.failed} lỗi.${detail}`;
      await namespaceTree.refresh();
    } catch (e) { ioErr = errorMessage(e); }
  }
</script>

{#if namespaceTree.error}<div class="error">{namespaceTree.error}</div>{/if}

<NamespaceTree
  databases={namespaceTree.databases}
  {connection}
  {onselect}
  {onselectdb}
  onmenu={(t) => (menu = t)}
/>

{#if menu}
  <ContextMenu
    x={menu.x}
    y={menu.y}
    items={menu.kind === "conn" ? connItems : menu.kind === "db" ? dbItems : collItems}
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
{:else if dialog?.type === "export"}
  {@const d = dialog}
  <ExportDialog scope={{ kind: "collection", coll: d.coll }}
    onexport={async (fmt) => { dialog = null; await runExportCollection(d.db, d.coll, fmt); }}
    oncancel={() => (dialog = null)} />
{:else if dialog?.type === "truncate"}
  {@const d = dialog}
  <DropConfirmDialog title="Truncate collection"
    message={`Xóa toàn bộ document trong "${d.coll}" (giữ index)? Không hoàn tác.`}
    expectedName={d.coll}
    onconfirm={async () => { await namespaceTree.truncate(d.db, d.coll); dialog = null; }}
    oncancel={() => (dialog = null)} />
{/if}

{#if io}<div class="io-ok">{io}</div>{/if}
{#if ioErr}<div class="error">{ioErr}</div>{/if}

<style>
  .error { background: #fdecea; color: #b71c1c; padding: 6px 10px; font-size: 12px; }
  .io-ok { background: #e6f4ea; color: #1b5e20; padding: 6px 10px; font-size: 12px; }
</style>
