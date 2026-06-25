<script lang="ts">
  import { commandLog } from "../stores/commandLog.svelte";
</script>

<div class="body">
  {#each commandLog.entries as e (e.n)}
    <div class="line"><span class="n">{e.n}</span><code>{e.text}</code></div>
  {/each}
</div>

<style>
  .body { flex: 1; overflow: auto; font-family: var(--mono); font-size: 0.75rem; line-height: 1.55; padding: 0.25rem 0; }
  .line { display: flex; padding: 0 0.5rem; white-space: pre; }
  .line:hover { background: #f2f2f2; }
  .n { width: 1.75rem; flex: none; text-align: right; color: #bbb; margin-right: 0.625rem; user-select: none; }
  code { font-family: var(--mono); }
</style>
