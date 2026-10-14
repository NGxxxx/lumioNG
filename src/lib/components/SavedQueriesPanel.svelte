<script lang="ts">
  import { queryLibrary } from "../stores/queryLibrary.svelte";
  import { shell } from "../stores/shell.svelte";
  import { canMove, queryCountIn, visibleRows, type QueryNode, type SavedQuery } from "../domain/queryTree";
  import ContextMenu from "./ContextMenu.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import NameDialog from "./NameDialog.svelte";
  import * as m from "$lib/paraglide/messages";

  let { onopen }: { onopen: (q: SavedQuery) => void } = $props();

  // Expanded-folder state is component-local (not persisted) — acceptable for v1 per spec.
  let expanded = $state<Set<number>>(new Set());
  const rows = $derived(visibleRows(queryLibrary.nodes, expanded));

  // node === null → panel background (root-level menu).
  let menu = $state<{ x: number; y: number; node: QueryNode | null } | null>(null);
  let dialog = $state<
    | { type: "rename"; node: QueryNode }
    | { type: "newFolder"; parentId: number | null }
    | { type: "delete"; node: QueryNode }
    | null
  >(null);
  let draggingId = $state<number | null>(null);
  // undefined = no target; null = root (panel background); number = folder id.
  let dropTarget = $state<number | null | undefined>(undefined);

  const queryItems = $derived([
    { label: m.saved_queries_menu_open(), action: "open" },
    { label: m.saved_queries_menu_rename(), action: "rename" },
    { label: m.saved_queries_menu_delete(), action: "delete" },
  ]);
  const folderItems = $derived([
    { label: m.saved_queries_menu_new_folder(), action: "newFolder" },
    { label: m.saved_queries_menu_rename(), action: "rename" },
    { label: m.saved_queries_menu_delete(), action: "delete" },
  ]);
  const rootItems = $derived([{ label: m.saved_queries_menu_new_folder(), action: "newFolder" }]);

  function toggleFolder(id: number) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }

  function onMenuSelect(action: string) {
    const t = menu;
    menu = null;
    if (!t) return;
    if (action === "open" && t.node?.kind === "query") onopen(t.node);
    else if (action === "rename" && t.node) dialog = { type: "rename", node: t.node };
    else if (action === "delete" && t.node) dialog = { type: "delete", node: t.node };
    else if (action === "newFolder") dialog = { type: "newFolder", parentId: t.node?.kind === "folder" ? t.node.id : null };
  }

  function rowDragOver(e: DragEvent, node: QueryNode) {
    if (node.kind !== "folder" || draggingId === null || !canMove(queryLibrary.nodes, draggingId, node.id)) return;
    e.preventDefault();
    e.stopPropagation();
    dropTarget = node.id;
  }

  function rowDrop(e: DragEvent, node: QueryNode) {
    e.preventDefault();
    e.stopPropagation();
    if (node.kind === "folder" && draggingId !== null) queryLibrary.move(draggingId, node.id);
    draggingId = null;
    dropTarget = undefined;
  }

  function bgDragOver(e: DragEvent) {
    if (draggingId === null) return;
    e.preventDefault();
    dropTarget = null;
  }

  function bgDrop(e: DragEvent) {
    e.preventDefault();
    if (draggingId !== null) queryLibrary.move(draggingId, null);
    draggingId = null;
    dropTarget = undefined;
  }
</script>

<div class="sq-panel" class:collapsed={!shell.savedQueriesOpen}>
  <div
    class="sq-header"
    role="button"
    tabindex="0"
    onclick={() => shell.toggleSavedQueries()}
    onkeydown={(e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) shell.toggleSavedQueries(); }}
  >
    <svg aria-hidden="true" class="caret" width="9" height="9" viewBox="0 0 9 9">
      {#if shell.savedQueriesOpen}
        <path d="M1.5 2 L4.5 6 L7.5 2z" fill="var(--muted)"/>
      {:else}
        <path d="M2 1.5 L6 4.5 L2 7.5z" fill="var(--muted)"/>
      {/if}
    </svg>
    <span class="title">{m.saved_queries_title()}</span>
    <button
      class="sq-new-folder"
      title={m.saved_queries_new_folder_title()}
      aria-label={m.saved_queries_new_folder_title()}
      onclick={(e) => {
        e.stopPropagation();
        if (!shell.savedQueriesOpen) shell.toggleSavedQueries();
        dialog = { type: "newFolder", parentId: null };
      }}
    >+</button>
  </div>

  {#if shell.savedQueriesOpen}
    {#if queryLibrary.loadError}
      <div class="error">{queryLibrary.loadError} — {m.saved_queries_blocked_hint()}</div>
    {/if}
    {#if queryLibrary.saveError}
      <div class="error">{queryLibrary.saveError}</div>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="sq-body"
      class:drop-root={dropTarget === null}
      style="height:{shell.savedQueriesHeight}px"
      ondragover={bgDragOver}
      ondrop={bgDrop}
      ondragleave={() => { if (dropTarget === null) dropTarget = undefined; }}
      oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); menu = { x: e.clientX, y: e.clientY, node: null }; }}
    >
      {#if rows.length === 0 && !queryLibrary.loadError}
        <div class="empty">{m.saved_queries_empty()}</div>
      {/if}
      {#each rows as { node, depth } (node.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
        <div
          class="row"
          class:drop={dropTarget === node.id}
          style="padding-left:{0.5 + depth * 0.875}rem"
          draggable="true"
          ondragstart={(e) => { draggingId = node.id; if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; }}
          ondragend={() => { draggingId = null; dropTarget = undefined; }}
          ondragover={(e) => rowDragOver(e, node)}
          ondragleave={() => { if (dropTarget === node.id) dropTarget = undefined; }}
          ondrop={(e) => rowDrop(e, node)}
          onclick={() => { if (node.kind === "folder") toggleFolder(node.id); }}
          ondblclick={() => { if (node.kind === "query") onopen(node); }}
          oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); menu = { x: e.clientX, y: e.clientY, node }; }}
        >
          {#if node.kind === "folder"}
            {#if expanded.has(node.id)}
              <!-- Open folder: back panel + tilted front flap -->
              <svg aria-hidden="true" class="icon" width="12" height="12" viewBox="0 0 16 16">
                <path d="M1.5 3.5h5l1.5 2h5.5v2h-12z" fill="var(--warn)" stroke="var(--fg)" stroke-width="0.6" opacity="0.55"/>
                <path d="M3 7.5h12l-2.5 5H1.5z" fill="var(--warn)" stroke="var(--fg)" stroke-width="0.6" opacity="0.85"/>
              </svg>
            {:else}
              <svg aria-hidden="true" class="icon" width="12" height="12" viewBox="0 0 16 16">
                <path d="M1.5 3.5h5l1.5 2h6.5v7h-13z" fill="var(--warn)" stroke="var(--fg)" stroke-width="0.6" opacity="0.85"/>
              </svg>
            {/if}
          {:else}
            <svg aria-hidden="true" class="icon" width="12" height="12" viewBox="0 0 16 16">
              <path d="M3 1.5h7l3 3v10H3z" fill="var(--panel)" stroke="var(--muted)" stroke-width="0.9"/>
              <path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" stroke="var(--link)" stroke-width="1"/>
            </svg>
          {/if}
          <span class="name" title={node.name}>{node.name}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if menu}
  <ContextMenu
    x={menu.x}
    y={menu.y}
    items={menu.node === null ? rootItems : menu.node.kind === "folder" ? folderItems : queryItems}
    onselect={onMenuSelect}
    onclose={() => (menu = null)}
  />
{/if}

{#if dialog?.type === "rename"}
  {@const d = dialog}
  <NameDialog
    title={m.saved_queries_rename_title()}
    label={m.saved_queries_rename_label()}
    initial={d.node.name}
    onsubmit={async (name) => {
      if (name) await queryLibrary.rename(d.node.id, name);
      dialog = null;
    }}
    oncancel={() => (dialog = null)}
  />
{:else if dialog?.type === "newFolder"}
  {@const d = dialog}
  <NameDialog
    title={m.saved_queries_new_folder_title()}
    label={m.saved_queries_new_folder_label()}
    onsubmit={async (name) => {
      if (name) {
        await queryLibrary.createFolder(name, d.parentId);
        if (d.parentId !== null) expanded = new Set([...expanded, d.parentId]);
      }
      dialog = null;
    }}
    oncancel={() => (dialog = null)}
  />
{:else if dialog?.type === "delete"}
  {@const d = dialog}
  <ConfirmDialog
    title={m.saved_queries_delete_title()}
    message={d.node.kind === "folder"
      ? m.saved_queries_delete_folder_message({ name: d.node.name, count: queryCountIn(queryLibrary.nodes, d.node.id) })
      : m.saved_queries_delete_query_message({ name: d.node.name })}
    danger
    onconfirm={() => { queryLibrary.remove(d.node.id); dialog = null; }}
    oncancel={() => (dialog = null)}
  />
{/if}

<style>
  .sq-panel { display: flex; flex-direction: column; flex: none; border-top: 1px solid var(--border); background: var(--bg); }
  .sq-header {
    display: flex; align-items: center; gap: 0.375rem; height: 1.625rem; padding: 0 0.5rem;
    background: var(--panel); border-bottom: 1px solid var(--border);
    font-size: var(--fs); font-weight: 600; cursor: pointer; user-select: none; flex: none;
  }
  .sq-header:hover { background: var(--row-hover); }
  .caret { flex: none; }
  .title { flex: 1; color: var(--text-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sq-new-folder {
    flex: none; width: 1.125rem; height: 1.125rem; display: flex; align-items: center; justify-content: center;
    background: none; border: none; cursor: pointer; color: var(--gray-99);
    font-size: 0.875rem; font-weight: 600; line-height: 1; border-radius: var(--radius-sm); padding: 0;
  }
  .sq-new-folder:hover { background: var(--hover); color: var(--fg); }
  .sq-body { overflow-y: auto; flex: none; }
  .sq-body.drop-root { box-shadow: inset 0 0 0 2px var(--accent); }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; font-size: var(--fs); }
  .empty { padding: 0.5rem 0.625rem; color: var(--muted); font-size: var(--fs); }
  .row {
    display: flex; align-items: center; gap: 0.3125rem; height: 1.375rem; padding-right: 0.375rem;
    font-size: var(--fs); cursor: default; user-select: none; white-space: nowrap;
  }
  .row:hover { background: var(--row-hover); }
  .row.drop { background: var(--hover); box-shadow: inset 0 0 0 1px var(--accent); }
  .icon { flex: none; }
  .name { overflow: hidden; text-overflow: ellipsis; }
</style>
