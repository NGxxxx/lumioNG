<script lang="ts">
  import { namespaceTree } from "../stores/namespaceTree.svelte";
  import NamespaceTree, { type TreeMenuTarget } from "./NamespaceTree.svelte";
  import { filterNamespaces } from "../domain/nsfilter";
  import { navigation } from "../stores/navigation.svelte";
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
  import * as m from "$lib/paraglide/messages";

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
  let query = $state("");
  const filtered = $derived(filterNamespaces(namespaceTree.databases, query));

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

  const connItems = $derived([
    { label: m.namespace_panel_menu_new_db(), action: "newDb" },
    { label: m.menu_refresh(), action: "refresh" },
    { label: m.namespace_panel_menu_manage_sessions(), action: "manageSessions" },
    { label: m.namespace_panel_menu_disconnect(), action: "disconnect" },
  ]);
  const dbItems = $derived([
    { label: m.namespace_panel_menu_new_coll(), action: "newColl" },
    { label: m.namespace_panel_menu_copy_name(), action: "copyName" },
    { label: m.menu_refresh(), action: "refresh" },
    { label: m.namespace_panel_menu_drop_db(), action: "dropDb" },
  ]);
  const collItems = $derived([
    { label: m.namespace_panel_menu_new_aggregate(), action: "newQuery" },
    { label: m.namespace_panel_menu_export(), action: "export" },
    { label: m.namespace_panel_menu_import(), action: "import" },
    { label: m.namespace_panel_menu_copy_name(), action: "copyName" },
    { label: m.namespace_panel_menu_rename(), action: "rename" },
    { label: m.namespace_panel_menu_truncate(), action: "truncate" },
    { label: m.namespace_panel_menu_drop_coll(), action: "dropColl" },
  ]);

  function onMenuSelect(action: string) {
    const target = menu;
    menu = null;
    if (!target) return;
    if (target.kind === "conn") {
      if (action === "newDb") dialog = { type: "newDb" };
      else if (action === "refresh") namespaceTree.refresh();
      else if (action === "manageSessions") onmanagesessions?.();
      else if (action === "disconnect") ondisconnect?.();
    } else if (target.kind === "db") {
      if (action === "newColl") dialog = { type: "newColl", db: target.db };
      else if (action === "copyName") navigator.clipboard.writeText(target.db);
      else if (action === "refresh") namespaceTree.refresh();
      else if (action === "dropDb") dialog = { type: "dropDb", db: target.db };
    } else {
      if (action === "newQuery") onnewquery?.({ db: target.db, coll: target.coll });
      else if (action === "export") dialog = { type: "export", db: target.db, coll: target.coll };
      else if (action === "import") runImport(target.db, target.coll);
      else if (action === "copyName") navigator.clipboard.writeText(`${target.db}.${target.coll}`);
      else if (action === "rename") dialog = { type: "rename", db: target.db, coll: target.coll };
      else if (action === "truncate") dialog = { type: "truncate", db: target.db, coll: target.coll };
      else if (action === "dropColl") dialog = { type: "dropColl", db: target.db, coll: target.coll };
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
        io = m.namespace_panel_export_done({ count: n });
        commandLog.push(exportBsonCmd(db, coll, path));
      } else {
        const data = await exportQuery(db, coll, "{}", null, null);
        await writeTextFile(path, format === "json" ? toJsonArray(data) : toCsv(data));
        io = m.namespace_panel_export_done({ count: data.length });
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
      io = m.namespace_panel_import_done({ inserted: res.inserted, failed: res.failed }) + detail;
      await namespaceTree.refresh();
    } catch (e) { ioErr = errorMessage(e); }
  }
</script>

{#if namespaceTree.error}<div class="error">{namespaceTree.error}</div>{/if}

<div class="ns-search">
  <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16">
    <circle cx="7" cy="7" r="4.2" fill="none" stroke="#888" stroke-width="1.3"/>
    <path d="M10.2 10.2 L14 14" stroke="#888" stroke-width="1.5"/>
  </svg>
  <input
    type="text"
    placeholder={m.namespace_panel_filter_placeholder()}
    bind:value={query}
    onkeydown={(e) => { if (e.key === "Escape") { query = ""; (e.currentTarget as HTMLInputElement).blur(); } }}
  />
  {#if query}<button class="ns-clear" aria-label={m.namespace_panel_clear_filter()} onclick={() => (query = "")}>×</button>{/if}
</div>

<NamespaceTree
  databases={filtered.databases}
  forceExpand={query ? filtered.expand : null}
  selected={navigation.selection}
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
    title={m.namespace_panel_new_coll_title()}
    label={m.namespace_panel_new_coll_label()}
    onsubmit={async (name) => {
      await namespaceTree.createCollection(d.db, name);
      dialog = null;
    }}
    oncancel={() => (dialog = null)}
  />
{:else if dialog?.type === "rename"}
  {@const d = dialog}
  <NameDialog
    title={m.namespace_panel_rename_title()}
    label={m.namespace_panel_rename_label()}
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
    title={m.drop_dialog_drop() + " collection"}
    message={m.namespace_panel_drop_coll_message({ coll: d.coll, db: d.db })}
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
    title={m.drop_dialog_drop() + " database"}
    message={m.namespace_panel_drop_db_message({ db: d.db })}
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
  <DropConfirmDialog title={m.namespace_panel_truncate_title()}
    message={m.namespace_panel_truncate_message({ coll: d.coll })}
    expectedName={d.coll}
    onconfirm={async () => { await namespaceTree.truncate(d.db, d.coll); dialog = null; }}
    oncancel={() => (dialog = null)} />
{/if}

{#if io}<div class="io-ok">{io}</div>{/if}
{#if ioErr}<div class="error">{ioErr}</div>{/if}

<style>
  .error { background: #fdecea; color: #b71c1c; padding: 6px 10px; font-size: 12px; }
  .io-ok { background: #e6f4ea; color: #1b5e20; padding: 6px 10px; font-size: 12px; }
  .ns-search { display: flex; align-items: center; gap: 5px; height: 26px; padding: 0 8px; border-bottom: 1px solid var(--border); background: var(--panel); }
  .ns-search input { flex: 1; border: none; background: none; font-size: 12px; outline: none; }
  .ns-clear { border: none; background: none; cursor: pointer; color: #999; font-size: 14px; line-height: 1; padding: 0 2px; }
  .ns-clear:hover { color: #444; }
</style>
