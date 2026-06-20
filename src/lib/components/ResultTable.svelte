<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createCollectionView } from "../stores/collectionView.svelte";
  import type { Doc } from "../domain/columns";
  import BsonCell from "./BsonCell.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import { idJson } from "../domain/docid";
  import { getByPath } from "../domain/schema";
  import BulkDialog from "./BulkDialog.svelte";
  import { isEmptyFilter } from "../domain/bulk";
  import { statusPill, jsonValueColor } from "../domain/theme";
  import type { ValueKind } from "../domain/theme";
  import { describeValue } from "../domain/extjson";

  let {
    db,
    coll,
    onopendocument,
  }: {
    db: string;
    coll: string;
    onopendocument: (doc: Doc | null, mode: "edit" | "insert") => void;
  } = $props();

  const v = untrack(() => createCollectionView(db, coll));
  let scroller = $state<HTMLDivElement>();
  let chooserOpen = $state(false);
  let view = $state<"grid" | "tree">("grid");
  let selectedRow = $state<number | null>(null);
  let openDocs = $state<Record<string, boolean>>({});

  function toggleDoc(key: string) {
    openDocs = { ...openDocs, [key]: !openDocs[key] };
  }

  /** Map BsonType → ValueKind for color lookup (same logic as BsonCell). */
  function toValueKind(type: string): ValueKind | null {
    switch (type) {
      case "string": return "string";
      case "int": case "long": case "double": case "decimal": return "number";
      case "bool": return "bool";
      case "objectId": return "objectid";
      case "date": return "date";
      case "null": return "null";
      default: return null;
    }
  }

  /** Return inline color style for a value. */
  function valColor(v: unknown): string {
    const info = describeValue(v);
    const kind = toValueKind(info.type);
    if (kind) return `color:${jsonValueColor(kind)}`;
    if (info.type === "object") return "color:#7b53b8";
    if (info.type === "array") return "color:#a07b2f";
    return "color:#444";
  }

  /** Short display string for _id header. */
  function idShort(doc: Doc): string {
    const id = doc._id;
    if (id === undefined || id === null) return "(no _id)";
    const info = describeValue(id);
    const s = info.display;
    return s.length > 24 ? s.slice(0, 22) + "…" : s;
  }

  /** Summary text shown when doc is collapsed. */
  function docSummary(doc: Doc): string {
    const keys = Object.keys(doc);
    const extra = keys.length - 1; // excluding _id
    return extra > 0 ? `+${extra} field${extra > 1 ? "s" : ""}` : "";
  }

  const visibleColumns = $derived(v.columnFields.filter((c) => !v.hidden.has(c.path)));

  function sortDirOf(path: string): 1 | -1 | null {
    const k = v.sortKeys.find((s) => s.path === path);
    return k ? k.dir : null;
  }
  function sortRankOf(path: string): number | null {
    if (v.sortKeys.length < 2) return null;
    const i = v.sortKeys.findIndex((s) => s.path === path);
    return i === -1 ? null : i + 1;
  }

  function toggleChooser() {
    if (!chooserOpen) v.resetProjectionDraft();
    chooserOpen = !chooserOpen;
  }
  function applyChooser() {
    v.applyProjection();
    chooserOpen = false;
  }

  async function openEdit(d: Doc) {
    onopendocument(await v.openDoc(d), "edit");
  }

  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  function onScroll() {
    if (!scroller) return;
    const { scrollTop, scrollHeight, clientHeight } = scroller;
    if (scrollHeight - scrollTop - clientHeight < 300) v.loadMore();
  }

  function onEditKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      v.commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      v.cancelEdit();
    }
  }

  async function onMenuSelect(action: string) {
    const r = v.onMenuSelect(action);
    if (r) onopendocument(await v.openDoc(r.open), "edit");
  }

  onMount(() => {
    v.init();
  });
</script>

<div class="result">
  <div class="toolbar">
    <button onclick={() => onopendocument(null, "insert")}>+ New document</button>
    <button onclick={() => v.openBulk("update")}>Update many…</button>
    <button onclick={() => v.openBulk("delete")}>Delete many…</button>
    <button onclick={() => v.exportAs("json")} disabled={v.ioBusy}>Export JSON</button>
    <button onclick={() => v.exportAs("csv")} disabled={v.ioBusy}>Export CSV</button>
    <button onclick={() => v.importDocs()} disabled={v.ioBusy}>Import…</button>
    <label class="pagesize">Rows/page
      <input
        type="number"
        min="1"
        value={v.pageSize}
        onchange={(e) => v.setPageSize(Math.max(1, +e.currentTarget.value || 50))}
      />
    </label>
    <div class="chooser-wrap">
      <button onclick={toggleChooser}>Columns…</button>
      {#if chooserOpen}
        <div class="chooser">
          {#each v.columnFields as c}
            <label class="chooser-row">
              <input
                type="checkbox"
                checked={!v.hiddenDraft.has(c.path)}
                onchange={() => v.toggleHiddenDraft(c.path)}
              />
              {c.path}
            </label>
          {/each}
          <button class="chooser-apply" onclick={applyChooser}>Apply</button>
        </div>
      {/if}
    </div>
  </div>
  {#if v.ioMessage}<div class="io-ok">{v.ioMessage}</div>{/if}
  {#if v.ioError}<div class="error">{v.ioError}</div>{/if}
  {#if v.error}<div class="error">{v.error}</div>{/if}
  <!-- Filter bar: find { … } monospace display + Run button -->
  <div class="filterbar">
    <span class="filter-label">find</span>
    <input
      class="filter-input"
      bind:value={v.filterText}
      placeholder={'{ "field": value }'}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          v.applyFilter();
        }
      }}
    />
    <button class="btn-run" onclick={v.applyFilter}>
      <svg width="11" height="11" viewBox="0 0 16 16"><path d="M4 3l9 5-9 5z" fill="#fff"/></svg>
      Run
    </button>
    <div class="view-toggle">
      <button
        class="toggle-btn"
        class:toggle-active={view === "grid"}
        onclick={() => { view = "grid"; }}
        title="Grid view"
      >
        <svg width="13" height="13" viewBox="0 0 16 16"><rect x="2" y="2.5" width="12" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M2 6h12M2 9.5h12M6.5 2.5v11" stroke="currentColor" stroke-width="0.9"/></svg>
        Grid
      </button>
      <button
        class="toggle-btn"
        class:toggle-active={view === "tree"}
        onclick={() => { view = "tree"; }}
        title="Tree view"
      >
        <svg width="13" height="13" viewBox="0 0 16 16"><path d="M6 2.5C4 2.5 4 5 4 6.5S2.5 8 2.5 8 4 8.5 4 10s0 3.5 2 3.5M10 2.5c2 0 2 2.5 2 4s1.5 1.5 1.5 1.5S12 8.5 12 10s0 3.5-2 3.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
        Tree
      </button>
    </div>
  </div>
  {#if v.filterError}<div class="error">{v.filterError}</div>{/if}

  {#if view === "grid"}
  <div class="scroller" bind:this={scroller} onscroll={onScroll}>
    <table>
      <thead>
        <tr>
          <th class="th-rownum">#</th>
          <th class="th-actions"></th>
          {#each visibleColumns as c}
            <th
              onclick={(e) => v.toggleSort(c.path, e.shiftKey)}
            ><span class="colname">{c.path}</span>{#if sortDirOf(c.path)}<span class="sortarrow"
                >{sortDirOf(c.path) === 1 ? "▲" : "▼"}</span
              >{/if}{#if sortRankOf(c.path)}<span class="sortrank">{sortRankOf(c.path)}</span
              >{/if}{#if c.type}<span class="badge"
                >{c.type}{#if c.mixed}*{/if}</span
              >{/if}{#if c.presence !== undefined && c.presence < 1}<span
                class="presence"
                title={`Hiện diện ${Math.round(c.presence * 100)}% mẫu`}>{Math.round(c.presence * 100)}%</span
              >{/if}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each v.docs as d, row}
          <tr
            style="background:{selectedRow === row ? 'var(--row-selected)' : (row % 2 === 0 ? 'var(--zebra)' : 'var(--zebra-alt)')}"
            onclick={() => { selectedRow = row; }}
          >
            <td class="td-rownum">{row + 1}</td>
            <td class="actions">
              <button onclick={() => openEdit(d)}>Edit</button>
              <button onclick={() => v.requestDelete(d)}>Delete</button>
            </td>
            {#each visibleColumns as c}
              {@const k = c.path}
              <td class="data-cell" oncontextmenu={(e) => v.openMenu(e, row, k)} ondblclick={() => v.startEdit(row, k)}>
                {#if v.editing && v.editing.row === row && v.editing.key === k}
                  <input
                    class="celledit"
                    bind:value={v.editText}
                    onkeydown={onEditKey}
                    onblur={v.cancelEdit}
                    use:focusSelect
                  />
                  {#if v.editError}<div class="cellerror">{v.editError}</div>{/if}
                {:else}
                  {@const val = getByPath(d, k)}
                  {#if val !== undefined}
                    {#if k === "status" && typeof val === "string"}
                      {@const pill = statusPill(val)}
                      <span class="pill" style="color:{pill.color}; background:{pill.bg};">{val}</span>
                    {:else}
                      <BsonCell value={val} />
                    {/if}
                  {/if}
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
    {#if v.loading}<div class="status">Đang tải…</div>{/if}
    {#if v.done}<div class="status">— hết —</div>{/if}
  </div>
  {:else}
  <!-- Tree view -->
  <div class="tree-scroller" bind:this={scroller} onscroll={onScroll}>
    {#each v.docs as doc, i}
      {@const docKey = idJson(doc) ?? `__idx_${i}`}
      {@const open = !!openDocs[docKey]}
      {@const entries = Object.entries(doc)}
      <div class="tree-doc">
        <!-- Header row -->
        <div class="tree-header" onclick={() => toggleDoc(docKey)} role="button" tabindex="0"
          onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleDoc(docKey); } }}>
          <svg width="9" height="9" viewBox="0 0 9 9" class="tree-caret" class:tree-caret-open={open}>
            <path d={open ? "M1.5 3l3 3 3-3" : "M3 1.5l3 3-3 3"} fill="#888" stroke="#888" stroke-width="0.8" fill-rule="evenodd"/>
          </svg>
          <span class="tree-n">{i + 1}</span>
          <span class="tree-brace">{"{" }</span>
          <span class="tree-idkey">_id</span><span class="tree-colon">:</span><span class="tree-idval">{idShort(doc)}</span>
          {#if !open}<span class="tree-summary">{docSummary(doc)}</span>{/if}
          {#if open}<span class="tree-brace-close-hint"> … }</span>{/if}
        </div>
        <!-- Expanded body -->
        {#if open}
          <div class="tree-body">
            {#each entries as [key, val]}
              <div class="tree-line">
                <span class="tree-key">{key}</span><span class="tree-colon">:</span><span class="tree-val" style={valColor(val)}>{describeValue(val).display}</span>
              </div>
            {/each}
            <div class="tree-close-brace">{"}"}</div>
          </div>
        {/if}
      </div>
    {/each}
    {#if v.loading}<div class="status">Đang tải…</div>{/if}
    {#if v.done}<div class="status">— hết —</div>{/if}
  </div>
  {/if}
</div>

{#if v.bulkMode}
  <BulkDialog
    mode={v.bulkMode}
    appliedFilter={v.appliedFilter}
    isEmpty={isEmptyFilter(v.appliedFilter)}
    bind:updateText={v.bulkUpdateText}
    updateError={v.bulkUpdateError}
    bind:confirmAll={v.bulkConfirmAll}
    count={v.bulkCount}
    counting={v.bulkCounting}
    running={v.bulkRunning}
    result={v.bulkResult}
    error={v.bulkError}
    canRun={v.canRunBulk}
    oncount={v.countBulk}
    onrun={v.runBulk}
    onclose={v.closeBulk}
  />
{/if}

{#if v.confirmDoc}
  <ConfirmDialog
    idText={idJson(v.confirmDoc) ?? "(không có _id)"}
    onconfirm={v.confirmDelete}
    oncancel={v.cancelDelete}
  />
{/if}

{#if v.menu}
  <ContextMenu
    x={v.menu.x}
    y={v.menu.y}
    items={v.menuItems()}
    onselect={onMenuSelect}
    onclose={v.closeMenu}
  />
{/if}

<style>
  .result { display: flex; flex-direction: column; height: 100%; }
  .toolbar { display: flex; align-items: center; gap: 12px; padding: 6px 8px; border-bottom: 1px solid #eee; }
  .scroller { overflow: auto; flex: 1; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; white-space: nowrap; }

  /* === Header === */
  th {
    background: linear-gradient(var(--th-grad-top), var(--th-grad-bottom));
    border: 1px solid #d0d0d0;
    padding: 4px 9px;
    font-weight: 600;
    position: sticky;
    top: 0;
    z-index: 2;
    cursor: pointer;
    user-select: none;
    color: #222;
    text-align: left;
  }
  .th-rownum {
    width: 42px;
    text-align: right;
    color: #888;
    font-weight: 500;
    position: sticky;
    left: 0;
    top: 0;
    z-index: 3;
    padding: 4px 6px;
  }
  .th-actions { white-space: nowrap; }

  /* === Cells === */
  td {
    border: 1px solid var(--cell-border);
    padding: 3px 9px;
    white-space: nowrap;
  }
  .td-rownum {
    text-align: right;
    color: #999;
    background: #f6f6f6;
    position: sticky;
    left: 0;
    z-index: 1;
    padding: 3px 6px;
    font-size: 11px;
  }
  td.actions { white-space: nowrap; }
  td.actions button { font-size: 11px; margin-right: 4px; }
  .data-cell { padding: 0; height: 22px; }
  .data-cell :global(.cell) { padding: 0 9px; display: inline-block; height: 22px; line-height: 22px; }

  /* === Pill for status column === */
  .pill {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 9px;
    font-size: 11px;
    font-weight: 600;
    margin: 2px 9px;
  }

  /* === Edit cell === */
  .celledit { width: 100%; box-sizing: border-box; font-family: ui-monospace, monospace; font-size: 12px; padding: 2px 4px; }
  .cellerror { color: #b71c1c; font-size: 11px; margin-top: 2px; }

  /* === Column header decorations === */
  .colname { font-weight: 600; }
  .badge { margin-left: 6px; font-size: 10px; color: #555; background: #e8e8e8; border-radius: 3px; padding: 0 4px; font-family: ui-monospace, monospace; }
  .presence { margin-left: 4px; font-size: 10px; color: #999; }
  .sortarrow { margin-left: 4px; font-size: 10px; color: #1565c0; }
  .sortrank { margin-left: 2px; font-size: 9px; color: #1565c0; vertical-align: super; }

  /* === Filter bar === */
  .filterbar {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    flex: none;
    background: #f7f9fb;
    border-bottom: 1px solid #e2e2e2;
    padding: 0 10px;
  }
  .filter-label { color: #777; font-size: 12px; }
  .filter-input {
    flex: 1;
    height: 21px;
    background: #fff;
    border: 1px solid #c4c4c4;
    border-radius: 2px;
    padding: 0 8px;
    font-family: Consolas, monospace;
    font-size: 12px;
    box-sizing: border-box;
  }
  .btn-run {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 12px;
    background: #1f9d4d;
    color: #fff;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-weight: 600;
    font-size: 12px;
  }
  .btn-run:hover { background: #1a8a43; }

  /* === Grid/Tree toggle === */
  .view-toggle { display: flex; align-items: center; gap: 1px; margin-left: 4px; }
  .toggle-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 8px;
    font-size: 12px;
    border: 1px solid #ccc;
    background: #f0f0f0;
    cursor: pointer;
    color: #444;
    border-radius: 2px;
  }
  .toggle-btn:hover { background: #e4e4e4; }
  .toggle-active {
    background: #dcecfa;
    box-shadow: inset 0 0 0 1px #b9d8f2;
    color: var(--tab-active-fg);
  }

  /* === Error / status messages === */
  .error { background: #fdecea; color: #b71c1c; padding: 6px 10px; }
  .io-ok { background: #e8f5e9; color: #1b5e20; padding: 6px 10px; font-size: 12px; }
  .status { padding: 8px; color: #777; font-size: 12px; }

  /* === Toolbar misc === */
  .pagesize input { width: 64px; margin-left: 4px; }
  .chooser-wrap { position: relative; }
  .chooser { position: absolute; z-index: 10; top: 100%; right: 0; background: #fff; border: 1px solid #ccc; padding: 6px; min-width: 160px; max-height: 260px; overflow: auto; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
  .chooser-row { display: block; font-size: 12px; padding: 2px 0; white-space: nowrap; }
  .chooser-apply { margin-top: 6px; width: 100%; }

  /* === Tree view === */
  .tree-scroller {
    overflow: auto;
    flex: 1;
    background: #fff;
    font-family: Consolas, 'Courier New', monospace;
    font-size: 12.5px;
    line-height: 1.55;
    padding: 8px 0;
  }
  .tree-doc {
    border-bottom: 1px solid #f0f0f0;
    padding: 2px 0;
  }
  .tree-header {
    display: flex;
    align-items: center;
    padding: 1px 10px;
    cursor: default;
    white-space: nowrap;
    overflow: hidden;
    user-select: none;
    gap: 0;
  }
  .tree-header:hover { background: #f5f9fd; }
  .tree-caret {
    flex-shrink: 0;
    margin-right: 6px;
    transition: transform 0.1s;
  }
  .tree-n { color: #999; margin-right: 8px; }
  .tree-brace { color: #7b53b8; }
  .tree-brace-close-hint { color: #7b53b8; opacity: 0.5; margin-left: 4px; }
  .tree-idkey { color: #9a2f8f; margin-left: 6px; }
  .tree-colon { color: #555; }
  .tree-idval { color: #6b3fa0; margin-left: 5px; }
  .tree-summary { color: #bbb; margin-left: 8px; }
  .tree-body {
    padding: 1px 0 4px 0;
  }
  .tree-line {
    padding: 0 10px 0 26px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tree-key { color: #9a2f8f; }
  .tree-val { margin-left: 5px; }
  .tree-close-brace {
    padding: 1px 10px 1px 22px;
    color: #7b53b8;
  }
</style>
