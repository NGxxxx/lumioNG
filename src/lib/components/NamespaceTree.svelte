<script lang="ts" module>
  export type TreeMenuTarget =
    | { kind: "db"; db: string; x: number; y: number }
    | { kind: "coll"; db: string; coll: string; x: number; y: number };
</script>

<script lang="ts">
  import type { DbInfo } from "../api/connection";

  let {
    databases = [],
    selected = null,
    onselect,
    onnewdatabase,
    onmenu,
  }: {
    databases?: DbInfo[];
    selected?: { db: string; coll: string } | null;
    onselect?: (d: { db: string; coll: string }) => void;
    onnewdatabase?: () => void;
    onmenu?: (t: TreeMenuTarget) => void;
  } = $props();

  function dbMenu(e: MouseEvent, db: string) {
    e.preventDefault();
    onmenu?.({ kind: "db", db, x: e.clientX, y: e.clientY });
  }
  function collMenu(e: MouseEvent, db: string, coll: string) {
    e.preventDefault();
    onmenu?.({ kind: "coll", db, coll, x: e.clientX, y: e.clientY });
  }
</script>

<div class="tree" role="tree">
  <div class="toolbar">
    <button class="newdb" onclick={() => onnewdatabase?.()}>＋ New database</button>
  </div>
  {#each databases as d}
    <div class="db" role="treeitem" tabindex="-1" aria-selected={selected?.db === d.name} oncontextmenu={(e) => dbMenu(e, d.name)}>{d.name}</div>
    {#each d.collections as c}
      <button
        class="coll"
        class:active={selected?.db === d.name && selected?.coll === c}
        onclick={() => onselect?.({ db: d.name, coll: c })}
        oncontextmenu={(e) => collMenu(e, d.name, c)}>{c}</button>
    {/each}
  {/each}
</div>

<style>
  .tree { overflow: auto; height: 100%; font-size: 13px; }
  .toolbar { padding: 6px 8px; border-bottom: 1px solid #eee; }
  .newdb { width: 100%; text-align: left; border: 1px solid #ddd; background: #fafafa; border-radius: 4px; padding: 5px 8px; cursor: pointer; font-size: 12px; }
  .newdb:hover { background: #f0f0f0; }
  .db { font-weight: 600; padding: 6px 8px; background: #fafafa; }
  .coll { display: block; width: 100%; text-align: left; border: none; background: none; padding: 4px 8px 4px 20px; cursor: pointer; }
  .coll:hover { background: #f0f0f0; }
  .coll.active { background: #e3f2fd; }
</style>
