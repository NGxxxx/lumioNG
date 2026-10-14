<script lang="ts">
  import * as m from "$lib/paraglide/messages";
  import { settings } from "$lib/stores/settings.svelte";

  const DEPTHS = [1, 2, 3, 4, 5];
</script>

<label class="depth-ctl" title={m.result_grid_depth_title()}>
  <span>{m.result_grid_depth_label()}</span>
  <select
    value={settings.gridMaxDepth === null ? "all" : String(settings.gridMaxDepth)}
    onchange={(e) => {
      const val = e.currentTarget.value;
      settings.setGridMaxDepth(val === "all" ? null : Number(val));
    }}
  >
    {#each DEPTHS as d (d)}
      <option value={String(d)}>{d}</option>
    {/each}
    <option value="all">{m.result_grid_depth_all()}</option>
  </select>
</label>

<style>
  .depth-ctl {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: var(--fs);
    color: var(--gray-77);
  }
  .depth-ctl select {
    height: 1.375rem;
    font-size: var(--fs);
    border: 1px solid var(--gray-c4);
    background: var(--bg);
    color: var(--gray-44);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
</style>
