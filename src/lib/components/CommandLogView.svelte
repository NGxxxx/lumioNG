<script lang="ts">
  import { commandLog } from "../stores/commandLog.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";

  function dotColor(sessionId: string): string {
    return sessionManager.sessions.find((s) => s.id === sessionId)?.color ?? "#aaa";
  }
</script>

<div class="body">
  {#each commandLog.entries as e (e.n)}
    <div class="line">
      <span class="n">{e.n}</span>
      <span class="session-dot" style="background:{dotColor(e.sessionId)}"></span>
      <code>{e.text}</code>
    </div>
  {/each}
</div>

<style>
  .body { flex: 1; overflow: auto; font-family: var(--mono); font-size: 0.75rem; line-height: 1.55; padding: 0.25rem 0; }
  .line { display: flex; align-items: center; padding: 0 0.5rem; white-space: pre; }
  .line:hover { background: var(--bg); }
  .n { width: 1.75rem; flex: none; text-align: right; color: var(--gray-b8); margin-right: 0.375rem; user-select: none; }
  .session-dot { width: 0.4375rem; height: 0.4375rem; border-radius: 50%; flex: none; margin-right: 0.375rem; }
  code { font-family: var(--mono); }
</style>
