<script lang="ts">
  import { commandLog } from "../stores/commandLog.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import * as m from "$lib/paraglide/messages";

  const NEAR_BOTTOM_PX = 40;

  let bodyEl: HTMLDivElement | undefined;
  let wasNearBottom = true;

  function dotColor(sessionId: string): string {
    return sessionManager.sessions.find((s) => s.id === sessionId)?.color ?? "var(--muted)";
  }

  function timeOf(at: number): string {
    return new Date(at).toLocaleTimeString([], { hour12: false });
  }

  function onScroll() {
    if (!bodyEl) return;
    wasNearBottom = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight <= NEAR_BOTTOM_PX;
  }

  $effect(() => {
    // Re-run whenever entries change; scroll to bottom only if the user was already there.
    commandLog.entries;
    if (bodyEl && wasNearBottom) {
      bodyEl.scrollTop = bodyEl.scrollHeight;
    }
  });
</script>

<div class="body" bind:this={bodyEl} onscroll={onScroll}>
  {#if commandLog.entries.length === 0}
    <div class="empty">{m.command_log_empty()}</div>
  {/if}
  {#each commandLog.entries as e (e.n)}
    <div class="line">
      <span class="n">{e.n}</span>
      <span class="time">{timeOf(e.at)}</span>
      <span class="session-dot" style="background:{dotColor(e.sessionId)}"></span>
      <code>{e.text}</code>
      <span class="took">({e.tookMs}ms)</span>
    </div>
  {/each}
</div>

<style>
  .body { flex: 1; overflow: auto; font-family: var(--mono); font-size: var(--fs); line-height: 1.55; padding: 0.25rem 0; }
  .empty { padding: 0.375rem 0.625rem; color: var(--muted); font-size: var(--fs); }
  .line { display: flex; align-items: center; padding: 0 0.5rem; white-space: pre; }
  .line:hover { background: var(--bg); }
  .n { width: 1.75rem; flex: none; text-align: right; color: var(--gray-b8); margin-right: 0.375rem; user-select: none; }
  .time { flex: none; color: var(--muted); margin-right: 0.375rem; }
  .session-dot { width: 0.4375rem; height: 0.4375rem; border-radius: 50%; flex: none; margin-right: 0.375rem; }
  code { font-family: var(--mono); }
  .took { flex: none; color: var(--muted); margin-left: 0.375rem; }
</style>
