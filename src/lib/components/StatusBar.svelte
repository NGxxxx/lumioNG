<!-- src/lib/components/StatusBar.svelte -->
<script lang="ts">
  import { formatUptime, formatDuration } from "../domain/host";
  import * as m from "$lib/paraglide/messages";

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
  } = $props();

  const label = $derived(selDb ?? connectionLabel ?? "—");
  const serverTime = $derived(serverTimeIso ? new Date(serverTimeIso).toLocaleTimeString() : "—");

  // Tick a 1s clock while connected so the "connected for" duration stays live.
  let now = $state(Date.now());
  $effect(() => {
    if (!connected || connectedAt === null) return;
    const id = setInterval(() => { now = Date.now(); }, 1000);
    return () => clearInterval(id);
  });
  const connectedFor = $derived(
    connected && connectedAt !== null ? formatDuration((now - connectedAt) / 1000) : "—",
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
</div>

<style>
  .statusbar {
    display: flex;
    align-items: center;
    height: 24px;
    flex: none;
    background: var(--bg, #f0f0f0);
    border-top: 1px solid #d8d8d8;
    font-size: 11px;
    color: #555;
    user-select: none;
  }

  .seg {
    padding: 0 10px;
    border-right: 1px solid #dcdcdc;
    height: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .idle {
    margin-left: auto;
    border-right: none;
    color: #888;
  }

  .idle.busy {
    color: var(--accent, #13aa52);
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #ccc;
    display: inline-block;
    flex: none;
  }

  .dot.on {
    background: var(--accent, #13aa52);
  }
</style>
