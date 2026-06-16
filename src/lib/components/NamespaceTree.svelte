<script lang="ts">
  import type { DbInfo } from "../ipc";

  let {
    databases = [],
    selected = null,
    onselect,
  }: {
    databases?: DbInfo[];
    selected?: { db: string; coll: string } | null;
    onselect?: (d: { db: string; coll: string }) => void;
  } = $props();
</script>

<div class="tree">
  {#each databases as d}
    <div class="db">{d.name}</div>
    {#each d.collections as c}
      <button class="coll" class:active={selected?.db === d.name && selected?.coll === c}
        onclick={() => onselect?.({ db: d.name, coll: c })}>{c}</button>
    {/each}
  {/each}
</div>

<style>
  .tree { overflow: auto; height: 100%; font-size: 13px; }
  .db { font-weight: 600; padding: 6px 8px; background: #fafafa; }
  .coll { display: block; width: 100%; text-align: left; border: none; background: none; padding: 4px 8px 4px 20px; cursor: pointer; }
  .coll:hover { background: #f0f0f0; }
  .coll.active { background: #e3f2fd; }
</style>
