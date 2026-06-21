<script lang="ts">
  import { commandLog } from "../stores/commandLog.svelte";
</script>

<div class="body">
  {#each commandLog.entries as e (e.n)}
    <div class="line"><span class="n">{e.n}</span><code>{e.text}</code></div>
  {/each}
</div>

<style>
  .body { flex: 1; overflow: auto; font-family: var(--mono); font-size: 12px; line-height: 1.55; padding: 4px 0; }
  .line { display: flex; padding: 0 8px; white-space: pre; }
  .line:hover { background: #f2f2f2; }
  .n { width: 28px; flex: none; text-align: right; color: #bbb; margin-right: 10px; user-select: none; }
  code { font-family: var(--mono); }
</style>
