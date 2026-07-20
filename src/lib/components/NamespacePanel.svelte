<script lang="ts">
  import { sessionManager } from "../stores/sessionManager.svelte";
  import NamespaceTree, { type TreeMenuTarget } from "./NamespaceTree.svelte";
  import { filterNamespaces } from "../domain/nsfilter";
  import ContextMenu from "./ContextMenu.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import NameDialog from "./NameDialog.svelte";
  import NewDatabaseDialog from "./NewDatabaseDialog.svelte";
  import DropConfirmDialog from "./DropConfirmDialog.svelte";
  import ExportWizard from "./ExportWizard.svelte";
  import ImportDialog from "./ImportDialog.svelte";
  import type { ExportWizardInput } from "../domain/exportPlan";
  import { validateCollectionName } from "../domain/namespaces";
  import * as m from "$lib/paraglide/messages";
  import type { Session } from "../stores/sessionManager.svelte";

  let {
    onselect,
    onselectdb,
    onnewquery,
    onmanagesessions,
    ondisconnect,
  }: {
    onselect?: (d: { db: string; coll: string }) => void;
    onselectdb?: (d: { db: string }) => void;
    onnewquery?: (d: { db: string; coll: string }) => void;
    onmanagesessions?: () => void;
    ondisconnect?: (sessionId: string) => void;
  } = $props();

  // Per-session: track which sessions are collapsed in the sidebar
  let collapsedSessions = $state<Set<string>>(new Set());

  function toggleSession(id: string) {
    const next = new Set(collapsedSessions);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsedSessions = next;
  }

  let menu = $state<(TreeMenuTarget & { sessionId: string }) | null>(null);
  let query = $state("");

  // Menu items per node kind
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
    { label: m.export_wizard_menu_export_db(), action: "exportDb" },
    { label: m.namespace_panel_menu_import(), action: "import" },
    { label: m.namespace_panel_menu_import_sql(), action: "importSql" },
    { label: m.namespace_panel_menu_drop_db(), action: "dropDb" },
  ]);
  const collItems = $derived([
    { label: m.namespace_panel_menu_new_aggregate(), action: "newQuery" },
    { label: m.namespace_panel_menu_export(), action: "export" },
    { label: m.namespace_panel_menu_import(), action: "import" },
    { label: m.namespace_panel_menu_copy_name(), action: "copyName" },
    { label: m.namespace_panel_menu_rename(), action: "rename" },
    { label: m.namespace_panel_menu_duplicate(), action: "duplicate" },
    { label: m.namespace_panel_menu_truncate(), action: "truncate" },
    { label: m.namespace_panel_menu_drop_coll(), action: "dropColl" },
  ]);

  type Dialog =
    | { type: "newDb"; sessionId: string }
    | { type: "newColl"; db: string; sessionId: string }
    | { type: "importTarget"; db: string; sessionId: string }
    | { type: "rename"; db: string; coll: string; sessionId: string }
    | { type: "duplicate"; db: string; coll: string; sessionId: string }
    | { type: "dropColl"; db: string; coll: string; sessionId: string }
    | { type: "dropDb"; db: string; sessionId: string }
    | { type: "truncate"; db: string; coll: string; sessionId: string };

  let dialog = $state<Dialog | null>(null);
  let exportWizard = $state<ExportWizardInput | null>(null);
  let importDialog = $state<{ sessionId: string; db: string; coll: string | null } | null>(null);
  // Confirmation gate shared by the session X button and the right-click Disconnect action.
  let confirmDisconnect = $state<{ label: string; run: () => void } | null>(null);

  function sessionById(id: string): Session | undefined {
    return sessionManager.sessions.find((s) => s.id === id);
  }

  function onMenuSelect(action: string) {
    const target = menu;
    menu = null;
    if (!target) return;
    const sess = sessionById(target.sessionId);
    const tree = sess?.tree ?? null;
    const databases = tree?.databases ?? [];

    if (target.kind === "conn") {
      if (action === "newDb") dialog = { type: "newDb", sessionId: target.sessionId };
      else if (action === "refresh") tree?.refresh();
      else if (action === "manageSessions") onmanagesessions?.();
      else if (action === "disconnect") {
        confirmDisconnect = { label: sess?.label ?? target.sessionId, run: () => ondisconnect?.(target.sessionId) };
      }
    } else if (target.kind === "db") {
      if (action === "newColl") dialog = { type: "newColl", db: target.db, sessionId: target.sessionId };
      else if (action === "copyName") navigator.clipboard.writeText(target.db);
      else if (action === "refresh") tree?.refresh();
      else if (action === "exportDb") {
        // The wizard exports the ACTIVE session, so focus the target's session first.
        sessionManager.focusSession(target.sessionId);
        const db = databases.find((d) => d.name === target.db);
        exportWizard = { mode: "pick", preChecked: (db?.collections ?? []).map((c) => ({ db: target.db, coll: c })) };
      }
      else if (action === "import") dialog = { type: "importTarget", db: target.db, sessionId: target.sessionId };
      else if (action === "importSql") openImportDialog(target.sessionId, target.db, null);
      else if (action === "dropDb") dialog = { type: "dropDb", db: target.db, sessionId: target.sessionId };
    } else {
      if (action === "newQuery") onnewquery?.({ db: target.db, coll: target.coll });
      else if (action === "export") {
        // The wizard exports the ACTIVE session, so focus the target's session first.
        sessionManager.focusSession(target.sessionId);
        exportWizard = { mode: "pick", preChecked: [{ db: target.db, coll: target.coll }] };
      }
      else if (action === "import") openImportDialog(target.sessionId, target.db, target.coll);
      else if (action === "copyName") navigator.clipboard.writeText(`${target.db}.${target.coll}`);
      else if (action === "rename") dialog = { type: "rename", db: target.db, coll: target.coll, sessionId: target.sessionId };
      else if (action === "duplicate") dialog = { type: "duplicate", db: target.db, coll: target.coll, sessionId: target.sessionId };
      else if (action === "truncate") dialog = { type: "truncate", db: target.db, coll: target.coll, sessionId: target.sessionId };
      else if (action === "dropColl") dialog = { type: "dropColl", db: target.db, coll: target.coll, sessionId: target.sessionId };
    }
  }

  /** `coll === null` is a whole-database SQL import; the dialog itself owns picking the file. */
  function openImportDialog(sessionId: string, db: string, coll: string | null) {
    importDialog = { sessionId, db, coll };
  }

  /** Toolbar entry point (mirrors the tree row's right-click Import) for the currently selected collection. */
  export function startImport(sessionId: string, db: string, coll: string) {
    openImportDialog(sessionId, db, coll);
  }

  function closeImportDialog() {
    if (!importDialog) return;
    sessionById(importDialog.sessionId)?.tree?.refresh();
    importDialog = null;
  }
</script>

<div class="ns-search">
  <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16">
    <circle cx="7" cy="7" r="4.2" fill="none" stroke="var(--muted)" stroke-width="1.3"/>
    <path d="M10.2 10.2 L14 14" stroke="var(--muted)" stroke-width="1.5"/>
  </svg>
  <input
    type="text"
    placeholder={m.namespace_panel_filter_placeholder()}
    bind:value={query}
    onkeydown={(e) => { if (e.key === "Escape") { query = ""; (e.currentTarget as HTMLInputElement).blur(); } }}
  />
  {#if query}<button class="ns-clear" aria-label={m.namespace_panel_clear_filter()} onclick={() => (query = "")}>×</button>{/if}
</div>

<div class="sessions-scroll">
{#each sessionManager.sessions as sess (sess.id)}
  {@const isCollapsed = collapsedSessions.has(sess.id)}
  {@const databases = sess.tree?.databases ?? []}
  {@const filtered = filterNamespaces(databases, query)}
  {@const isActive = sessionManager.activeId === sess.id}

  <div class="session-root" class:active={isActive}>
    <!-- Root header row -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="session-header"
      onclick={() => sess.status === "error" ? sessionManager.reconnect(sess.id) : sessionManager.focusSession(sess.id)}
      onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") sess.status === "error" ? sessionManager.reconnect(sess.id) : sessionManager.focusSession(sess.id); }}
      oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); menu = { kind: "conn", x: e.clientX, y: e.clientY, sessionId: sess.id }; }}
      role="button"
      tabindex="0"
    >
      <!-- Caret: toggles collapse only, does not focus -->
      <button
        class="session-caret-btn"
        aria-label={isCollapsed ? "Expand session" : "Collapse session"}
        onclick={(e) => { e.stopPropagation(); toggleSession(sess.id); }}
        onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); toggleSession(sess.id); } }}
        tabindex="-1"
      >
        <svg aria-hidden="true" class="session-caret" width="9" height="9" viewBox="0 0 9 9">
          {#if isCollapsed}
            <path d="M2 1.5 L6 4.5 L2 7.5z" fill="var(--muted)"/>
          {:else}
            <path d="M1.5 2 L4.5 6 L7.5 2z" fill="var(--muted)"/>
          {/if}
        </svg>
      </button>
      <!-- Color dot -->
      <span class="session-dot" style="background:{sess.color}"></span>
      <!-- Label -->
      <span class="session-label">{sess.label}</span>
      <!-- Status indicator -->
      {#if sess.status === "connecting"}
        <span class="status-spinner" aria-label="Connecting" title="Connecting…">
          <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" class="spin">
            <circle cx="12" cy="12" r="9" fill="none" stroke="var(--muted)" stroke-width="2.5" stroke-dasharray="30 56"/>
          </svg>
        </span>
      {:else if sess.status === "error"}
        <span class="status-error" aria-label="Connection error" title="Connection error">
          <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10">
            <circle cx="5" cy="5" r="4" fill="var(--danger)" stroke="none"/>
          </svg>
        </span>
      {:else}
        <span class="status-ok" aria-label="Connected" title="Connected">
          <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10">
            <circle cx="5" cy="5" r="4" fill="var(--ok-strong)" stroke="none"/>
          </svg>
        </span>
      {/if}
      <!-- Close button -->
      <button
        class="session-close"
        aria-label="Close session"
        title="Close session"
        onclick={(e) => { e.stopPropagation(); confirmDisconnect = { label: sess.label, run: () => sessionManager.closeSession(sess.id) }; }}
      >✕</button>
    </div>

    <!-- Tree body (shown when not collapsed) -->
    {#if !isCollapsed}
      {#if sess.tree?.error}
        <div class="error">{sess.tree.error}</div>
      {/if}
      <NamespaceTree
        databases={filtered.databases}
        forceExpand={query ? filtered.expand : null}
        selected={sess.nav.selection}
        onselect={(d) => { sessionManager.focusSession(sess.id); sess.nav.selectCollection(d.db, d.coll); onselect?.(d); }}
        onselectdb={(d) => { sessionManager.focusSession(sess.id); sess.nav.selectDatabase(d.db); onselectdb?.(d); }}
        onmenu={(t) => (menu = { ...t, sessionId: sess.id })}
      />
    {/if}
  </div>
{/each}
</div>

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
  {@const d = dialog}
  <NewDatabaseDialog
    onsubmit={async (db, coll) => {
      await sessionById(d.sessionId)?.tree?.createDatabase(db, coll);
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
      await sessionById(d.sessionId)?.tree?.createCollection(d.db, name);
      dialog = null;
    }}
    oncancel={() => (dialog = null)}
  />
{:else if dialog?.type === "importTarget"}
  {@const d = dialog}
  <NameDialog
    title={m.namespace_panel_import_target_title()}
    label={m.namespace_panel_import_target_label()}
    onsubmit={async (name) => {
      const msg = validateCollectionName(name);
      if (msg) throw msg;
      openImportDialog(d.sessionId, d.db, name);
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
      await sessionById(d.sessionId)?.tree?.renameCollection(d.db, d.coll, name);
      dialog = null;
    }}
    oncancel={() => (dialog = null)}
  />
{:else if dialog?.type === "duplicate"}
  {@const d = dialog}
  <NameDialog
    title={m.namespace_panel_duplicate_title()}
    label={m.namespace_panel_duplicate_label()}
    initial={`${d.coll}_copy`}
    onsubmit={async (name) => {
      await sessionById(d.sessionId)?.tree?.duplicateCollection(d.db, d.coll, name);
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
      await sessionById(d.sessionId)?.tree?.dropCollection(d.db, d.coll);
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
      await sessionById(d.sessionId)?.tree?.dropDatabase(d.db);
      dialog = null;
    }}
    oncancel={() => (dialog = null)}
  />
{:else if dialog?.type === "truncate"}
  {@const d = dialog}
  <DropConfirmDialog title={m.namespace_panel_truncate_title()}
    message={m.namespace_panel_truncate_message({ coll: d.coll })}
    expectedName={d.coll}
    confirmLabel={m.drop_dialog_truncate()}
    onconfirm={async () => { await sessionById(d.sessionId)?.tree?.truncate(d.db, d.coll); dialog = null; }}
    oncancel={() => (dialog = null)} />
{/if}

{#if exportWizard}
  <ExportWizard input={exportWizard} onclose={() => (exportWizard = null)} />
{/if}

{#if confirmDisconnect}
  {@const cd = confirmDisconnect}
  <ConfirmDialog
    title={m.namespace_panel_disconnect_confirm_title()}
    message={m.namespace_panel_disconnect_confirm_message({ label: cd.label })}
    confirmLabel={m.namespace_panel_menu_disconnect()}
    danger
    onconfirm={() => { cd.run(); confirmDisconnect = null; }}
    oncancel={() => (confirmDisconnect = null)}
  />
{/if}

{#if importDialog}
  {@const d = importDialog}
  <ImportDialog sessionId={d.sessionId} db={d.db} coll={d.coll} onclose={closeImportDialog} />
{/if}

<style>
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; font-size: 0.75rem; }
  .ns-search { display: flex; align-items: center; gap: 0.3125rem; height: 1.625rem; padding: 0 0.5rem; border-bottom: 1px solid var(--border); background: var(--panel); flex: none; }
  /* <aside> clips overflow (+page.svelte); this is the actual scroll region. */
  .sessions-scroll { flex: 1; min-height: 0; overflow-y: auto; }
  .ns-search input { flex: 1; border: none; background: none; font-size: 0.75rem; outline: none; }
  .ns-clear { border: none; background: none; cursor: pointer; color: var(--gray-99); font-size: 0.875rem; line-height: 1; padding: 0 0.125rem; }
  .ns-clear:hover { color: var(--gray-44); }

  /* ── Per-session root block ── */
  .session-root { display: flex; flex-direction: column; }
  .session-root.active > .session-header { background: var(--row-hover); }

  .session-header {
    display: flex;
    align-items: center;
    height: 1.625rem;
    padding: 0 0.375rem;
    gap: 0.25rem;
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    font-size: 0.75rem;
    font-weight: 600;
  }
  .session-header:hover { background: var(--row-hover); }

  .session-caret-btn {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 0;
    margin-right: 0.0625rem;
    cursor: pointer;
    line-height: 0;
    border-radius: 0.125rem;
  }
  .session-caret-btn:hover { background: rgba(0,0,0,0.07); }
  .session-caret { flex: none; }

  .session-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    flex: none;
    display: inline-block;
  }

  .session-label { flex: 1; color: var(--text-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .status-spinner,
  .status-error,
  .status-ok {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 0.875rem;
    height: 0.875rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .spin { animation: spin 0.9s linear infinite; }

  .session-close {
    flex: none;
    width: 1.125rem;
    height: 1.125rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--gray-99);
    font-size: 0.625rem;
    line-height: 1;
    border-radius: 0.125rem;
    padding: 0;
    opacity: 0;
    transition: opacity 0.1s;
  }
  .session-header:hover .session-close { opacity: 1; }
  .session-close:hover { background: var(--error-bg); color: var(--error); opacity: 1; }
</style>
