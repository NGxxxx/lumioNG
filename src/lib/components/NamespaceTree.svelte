<script lang="ts" module>
  export type TreeMenuTarget =
    | { kind: "conn"; x: number; y: number }
    | { kind: "db"; db: string; x: number; y: number }
    | { kind: "coll"; db: string; coll: string; x: number; y: number };
</script>

<script lang="ts">
  import type { DbInfo } from "../domain/namespaces";
  import { sortCollectionNames } from "../domain/namespaces";
  import { collectionSort } from "../stores/collectionSort.svelte";
  import * as m from "$lib/paraglide/messages";

  let {
    databases = [],
    selected = null,
    forceExpand = null,
    onselect,
    onselectdb,
    onmenu,
  }: {
    databases?: DbInfo[];
    selected?: { db: string; coll: string | null } | null;
    forceExpand?: Set<string> | null;
    onselect?: (d: { db: string; coll: string }) => void;
    onselectdb?: (d: { db: string }) => void;
    onmenu?: (t: TreeMenuTarget) => void;
  } = $props();

  // Databases start collapsed; opening one is explicit (or a search match via forceExpand).
  let expanded = $state<Set<string>>(new Set());
  const isOpen = (db: string) => (forceExpand?.has(db) ?? false) || expanded.has(db);
  const collCount = $derived(databases.reduce((n, d) => n + d.collections.length, 0));

  function toggle(db: string) {
    const next = new Set(expanded);
    if (next.has(db)) next.delete(db);
    else next.add(db);
    expanded = next;
  }
  function selectDb(db: string) {
    onselectdb?.({ db });
    toggle(db);
  }
  // stopPropagation: without it, the same right-click event bubbles to window and immediately closes the just-opened menu.
  function dbMenu(e: MouseEvent, db: string) {
    e.preventDefault();
    e.stopPropagation();
    onmenu?.({ kind: "db", db, x: e.clientX, y: e.clientY });
  }
  function collMenu(e: MouseEvent, db: string, coll: string) {
    e.preventDefault();
    e.stopPropagation();
    onmenu?.({ kind: "coll", db, coll, x: e.clientX, y: e.clientY });
  }
</script>

<div class="tree" role="tree">
  {#each databases as d (d.name)}
    <div
      class="db"
      role="treeitem"
      tabindex="-1"
      aria-selected={selected?.db === d.name && !selected?.coll}
      onclick={() => selectDb(d.name)}
      onkeydown={(e) => e.key === "Enter" && selectDb(d.name)}
      oncontextmenu={(e) => dbMenu(e, d.name)}
    >
      <!-- Caret SVG: rotated when open -->
      <svg aria-hidden="true" class="caret" width="9" height="9" viewBox="0 0 9 9">
        {#if !isOpen(d.name)}
          <path d="M2 1.5 L6 4.5 L2 7.5z" fill="var(--muted)"/>
        {:else}
          <path d="M1.5 2 L4.5 6 L7.5 2z" fill="var(--muted)"/>
        {/if}
      </svg>
      <!-- Purple cylinder icon -->
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" class="icon-db">
        <ellipse cx="8" cy="3.5" rx="5" ry="2" fill="var(--type-object-bg-tint)" stroke="var(--type-object)" stroke-width="1"/>
        <path d="M3 3.5v9c0 1.1 2.2 2 5 2s5-0.9 5-2v-9" fill="var(--type-object-bg-tint)" stroke="var(--type-object)" stroke-width="1"/>
        <path d="M3 8c0 1.1 2.2 2 5 2s5-0.9 5-2" fill="none" stroke="var(--type-object)" stroke-width="0.9"/>
      </svg>
      <span class="db-name">{d.name}</span>
      <span class="db-size">—</span>
    </div>
    {#if isOpen(d.name)}
      {#each sortCollectionNames(d.collections, collectionSort.current) as c (c)}
        <button
          class="coll"
          class:active={selected?.db === d.name && selected?.coll === c}
          onclick={() => onselect?.({ db: d.name, coll: c })}
          oncontextmenu={(e) => collMenu(e, d.name, c)}
        >
          <!-- Yellow table icon -->
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" class="icon-coll">
            <rect x="2" y="3" width="12" height="10" rx="1" fill="var(--warn-bg)" stroke="var(--warn)" stroke-width="0.9"/>
            <path d="M2 6h12M6 6v7" stroke="var(--warn)" stroke-width="0.8"/>
          </svg>
          <span class="coll-name">{c}</span>
          <span class="coll-count"></span>
        </button>
      {/each}
    {/if}
  {/each}
  <div class="footer">{m.namespace_tree_footer({ dbs: databases.length, colls: collCount })}</div>
</div>

<style>
  .tree {
    overflow: auto;
    height: 100%;
    font-size: 0.8125rem;
    display: flex;
    flex-direction: column;
    background: var(--panel);
  }

  /* ── Database row ── */
  .db {
    display: flex;
    align-items: center;
    height: 1.375rem;
    padding: 0 0.375rem 0 1.125rem;
    cursor: default;
    user-select: none;
    background: var(--panel);
  }
  .db:hover { background: var(--row-hover); }
  .db[aria-selected="true"] {
    background: var(--selected);
    box-shadow: inset 2px 0 0 var(--accent);
    font-weight: 600;
  }
  .caret { margin-right: 0.1875rem; flex: none; }
  .icon-db { margin-right: 0.3125rem; flex: none; }
  .db-name { color: var(--text-strong); flex: 1; font-size: 0.8125rem; }
  .db-size { color: var(--gray-99); font-size: 0.6875rem; margin-left: auto; flex: none; }

  /* ── Collection row ── */
  .coll {
    display: flex;
    align-items: center;
    width: 100%;
    height: 1.375rem;
    padding: 0 0.375rem 0 2.375rem;
    text-align: left;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 0.8125rem;
    color: var(--fg);
    box-sizing: border-box;
  }
  .coll:hover { background: var(--row-hover); }
  .coll.active {
    background: var(--selected);
    box-shadow: inset 2px 0 0 var(--accent);
    font-weight: 600;
  }
  .icon-coll { margin-right: 0.3125rem; flex: none; }
  .coll-name { flex: 1; }
  .coll-count { color: var(--gray-99); font-size: 0.6875rem; flex: none; }

  /* ── Footer ── */
  .footer {
    margin-top: auto;
    height: 1.375rem;
    display: flex;
    align-items: center;
    padding: 0 0.5rem;
    font-size: 0.6875rem;
    color: var(--gray-77);
    border-top: 1px solid var(--border);
    background: var(--zebra);
    flex: none;
  }
</style>
