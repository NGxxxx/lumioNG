<script lang="ts">
  import { commandLog, type LogEntry } from "../stores/commandLog.svelte";
  import { createClipboardCopy } from "../stores/clipboardCopy";
  import { toast } from "../stores/toast.svelte";
  import CommandTextDialog from "./CommandTextDialog.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import * as m from "#lib/paraglide/messages.js";

  const NEAR_BOTTOM_PX = 40;
  // Each line shows the start of its command; the full text opens on demand (it can be megabytes).
  const DISPLAY_MAX = 600;

  let viewing = $state<LogEntry | null>(null);
  const copyText = createClipboardCopy((msg) => toast.push(msg, "error"));

  async function copyEntry(e: LogEntry) {
    const r = await commandLog.fullText(e);
    await copyText(r.text);
    toast.push(r.complete ? m.command_log_copied() : m.command_log_copied_partial(), r.complete ? "success" : "error");
  }

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
      <code>{e.text.length > DISPLAY_MAX ? e.text.slice(0, DISPLAY_MAX) : e.text}</code>
      {#if e.length > DISPLAY_MAX}
        <button class="more" title={m.command_log_view_full()} onclick={() => (viewing = e)}>{m.command_log_more({ count: (e.length - DISPLAY_MAX).toLocaleString("en-US") })}</button>
      {/if}
      <span class="took">({e.tookMs}ms)</span>
      <span class="line-actions">
        <button title={m.command_log_view_full()} aria-label={m.command_log_view_full()} onclick={() => (viewing = e)}>
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 3.5h12M2 8h12M2 12.5h8" /></svg>
        </button>
        <button title={m.command_log_copy()} aria-label={m.command_log_copy()} onclick={() => copyEntry(e)}>
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5" /><path d="M10.5 5V3.5A1 1 0 0 0 9.5 2.5H3.5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1H5" /></svg>
        </button>
      </span>
    </div>
  {/each}
</div>

{#if viewing}<CommandTextDialog entry={viewing} onclose={() => (viewing = null)} />{/if}

<style>
  .body { flex: 1; overflow: auto; font-family: var(--mono); font-size: var(--fs); line-height: 1.55; padding: 0.25rem 0; }
  .empty { padding: 0.375rem 0.625rem; color: var(--muted); font-size: var(--fs); }
  .line { display: flex; align-items: center; padding: 0 0.5rem; white-space: pre; }
  .line:hover { background: var(--bg); }
  .n { width: 1.75rem; flex: none; text-align: right; color: var(--gray-99); margin-right: 0.375rem; user-select: none; }
  .time { flex: none; color: var(--muted); margin-right: 0.375rem; }
  .session-dot { width: 0.4375rem; height: 0.4375rem; border-radius: 50%; flex: none; margin-right: 0.375rem; }
  code { font-family: var(--mono); }
  .took { flex: none; color: var(--muted); margin-left: 0.375rem; }
  .more {
    flex: none; margin-left: 0.375rem; padding: 0 0.3125rem; border: 1px solid var(--border); border-radius: var(--radius-sm);
    background: var(--bg); color: var(--accent); font-family: var(--mono); font-size: 0.6875rem; cursor: pointer;
  }
  .line-actions { position: sticky; right: 0; margin-left: auto; padding-left: 0.5rem; display: none; gap: 0.125rem; background: var(--bg); }
  .line:hover .line-actions, .line:focus-within .line-actions { display: flex; }
  .line-actions button { display: inline-flex; padding: 0.125rem 0.25rem; border: 0; background: none; color: var(--muted); cursor: pointer; border-radius: var(--radius-sm); }
  .line-actions button:hover { color: var(--fg); background: var(--hover); }
</style>
