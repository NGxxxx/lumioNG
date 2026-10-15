<!-- src/lib/components/StatusBar.svelte -->
<script lang="ts">
  import { formatUptime } from "../domain/host";
  import * as m from "#lib/paraglide/messages.js";

  let {
    connected,
    connectionLabel,
    dbCount,
    collCount,
    selDb,
    selColl,
    version,
    uptimeSeconds,
    serverTimeIso,
    connectedAt = null,
    activityLabel = null,
    logOpen = false,
    logUnseen = 0,
    ontogglelog,
  }: {
    connected: boolean;
    connectionLabel: string | null;
    dbCount: number;
    collCount: number;
    selDb: string | null;
    selColl: string | null;
    version?: string | null;
    uptimeSeconds?: number | null;
    serverTimeIso?: string | null;
    connectedAt?: number | null;
    activityLabel?: string | null;
    logOpen?: boolean;
    /** Commands logged since the log was last open. */
    logUnseen?: number;
    ontogglelog?: () => void;
  } = $props();

  const label = $derived(selDb ?? connectionLabel ?? "—");
  const serverTime = $derived(serverTimeIso ? new Date(serverTimeIso).toLocaleTimeString() : "—");

  // "Connected for" duration at minute granularity — tick once a minute, not every second.
  let now = $state(Date.now());
  $effect(() => {
    if (!connected || connectedAt === null) return;
    const id = setInterval(() => { now = Date.now(); }, 60_000);
    return () => clearInterval(id);
  });
  const connectedFor = $derived(
    connected && connectedAt !== null ? formatUptime((now - connectedAt) / 1000) : "—",
  );
</script>

<div class="statusbar">
  <!-- Segment 1: db/collection context -->
  <div class="seg">
    <span class="dot" class:on={connected}></span>
    {#if connected}
      {m.status_bar_collections({ label, count: collCount })}
    {:else}
      {m.status_bar_disconnected()}
    {/if}
  </div>

  <!-- Segment 2: how long the current connection has been open -->
  <div class="seg">{m.status_bar_connected_time({ time: connectedFor })}</div>

  <!-- Segment 4: MongoDB version -->
  <div class="seg">{m.status_bar_mongodb_version({ version: version ?? "—" })}</div>

  <!-- Segment 5: uptime -->
  <div class="seg">{m.status_bar_uptime({ uptime: formatUptime(uptimeSeconds ?? null) })}</div>

  <!-- Segment 6: server time -->
  <div class="seg">{m.status_bar_server_time({ time: serverTime })}</div>

  <!-- Right: live activity (current operation) or idle -->
  <div class="seg idle" class:busy={activityLabel !== null}>{activityLabel ?? m.status_bar_idle()}</div>

  {#if ontogglelog}
    <button
      class="log-btn"
      class:on={logOpen}
      aria-pressed={logOpen}
      aria-label={m.toolbar_command_log()}
      data-unseen={logUnseen}
      onclick={ontogglelog}
    >
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 4h10M3 8h10M3 12h6" /></svg>
      <span>Log</span>
      {#if logUnseen > 0 && !logOpen}<span class="log-dot" aria-hidden="true"></span>{/if}
    </button>
  {/if}
</div>

<style>
  /* Sits on the window chrome below the inset panel: no own background or rules, just quiet text. */
  .statusbar {
    display: flex;
    align-items: center;
    height: 1.625rem;
    flex: none;
    padding: 0 0.375rem;
    background: var(--app-bg);
    font-size: 0.6875rem;
    color: var(--muted);
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
  }

  .seg {
    padding: 0 0.5rem;
    height: 100%;
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .seg + .seg:not(.idle)::before {
    content: "·";
    margin-right: 0.5rem;
    margin-left: -0.5rem;
    color: var(--c-overlay0);
  }

  .idle {
    margin-left: auto;
    color: var(--muted);
  }

  .idle.busy {
    color: var(--accent);
  }

  .log-btn {
    position: relative; display: inline-flex; align-items: center; gap: 0.3125rem; height: 1.25rem; padding: 0 0.5rem;
    margin-left: 0.25rem; border: none; border-radius: var(--radius-sm); background: none; color: var(--muted);
    font-size: 0.6875rem; cursor: pointer;
  }
  .log-btn:hover, .log-btn.on { background: var(--hover); color: var(--fg); }
  .log-dot {
    width: 0.375rem; height: 0.375rem; border-radius: 50%; background: var(--accent);
  }

  .dot {
    width: 0.4375rem;
    height: 0.4375rem;
    border-radius: 50%;
    background: var(--c-overlay0);
    display: inline-block;
    flex: none;
  }

  .dot.on {
    background: var(--ok-fg);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--ok-fg) 22%, transparent);
  }
</style>
