<script lang="ts">
  /** `unknown` covers the "started but no batch/total reported yet" gap — a bare bar reading 0%
   *  looks identical to "about to finish at 0 items", so callers pass `unknown` to show `label`
   *  (e.g. "Reading file…") as plain status text instead of a misleading empty bar. */
  let { done, total, label, unknown = false }: { done: number; total: number; label: string; unknown?: boolean } = $props();
  const percent = $derived(total > 0 ? Math.round((done / total) * 100) : 0);
</script>

{#if unknown}
  <div class="unknown">{label}</div>
{:else}
  <div class="progress">
    <div class="bar"><div class="fill" style="width:{percent}%"></div></div>
    <span>{label}</span>
  </div>
{/if}

<style>
  .progress { display: flex; align-items: center; gap: 0.5rem; }
  .bar { flex: 1; height: 0.5rem; background: var(--bg); border-radius: var(--radius); overflow: hidden; }
  .fill { height: 100%; background: var(--progress); transition: width .2s; }
  .unknown { color: var(--gray-77); }
</style>
