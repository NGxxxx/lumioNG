<script lang="ts">
  import type { Tab } from "../workspace.svelte";

  let {
    tabs,
    activeId,
    onactivate,
    onclose,
  }: {
    tabs: Tab[];
    activeId: number | null;
    onactivate: (id: number) => void;
    onclose: (id: number) => void;
  } = $props();

  function shorten(s: string): string {
    return s.length > 14 ? s.slice(0, 12) + "…" : s;
  }

  function title(t: Tab): string {
    if (t.kind === "collection") return t.coll;
    if (t.mode === "insert") return `${t.coll} / new`;
    return `${t.coll} / ${t.idText ? shorten(t.idText) : "?"}`;
  }
</script>

<div class="tabbar">
  {#each tabs as t (t.id)}
    <div class="tab" class:active={t.id === activeId}>
      <button class="label" onclick={() => onactivate(t.id)} title={title(t)}>{title(t)}</button>
      <button class="x" onclick={() => onclose(t.id)} aria-label="Close tab">×</button>
    </div>
  {/each}
</div>

<style>
  .tabbar { display: flex; border-bottom: 1px solid #ddd; background: #fafafa; overflow-x: auto; }
  .tab { display: flex; align-items: center; border-right: 1px solid #e0e0e0; max-width: 220px; }
  .tab.active { background: #fff; }
  .label { border: none; background: none; padding: 6px 8px; font-size: 12px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
  .x { border: none; background: none; padding: 4px 8px; cursor: pointer; color: #999; }
  .x:hover { color: #333; }
</style>
