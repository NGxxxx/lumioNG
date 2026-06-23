<!-- src/lib/components/StatusBar.svelte -->
<script lang="ts">
  import { formatUptime } from "../domain/host";
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
  } = $props();

  const label = $derived(selDb ?? connectionLabel ?? "—");
  const serverTime = $derived(serverTimeIso ? new Date(serverTimeIso).toLocaleTimeString() : "—");
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

  <!-- Segment 2: cell position placeholder -->
  <div class="seg">{m.status_bar_cell_pos()}</div>

  <!-- Segment 3: connected time placeholder -->
  <div class="seg">{m.status_bar_connected_time()}</div>

  <!-- Segment 4: MongoDB version -->
  <div class="seg">{m.status_bar_mongodb_version({ version: version ?? "—" })}</div>

  <!-- Segment 5: uptime -->
  <div class="seg">{m.status_bar_uptime({ uptime: formatUptime(uptimeSeconds ?? null) })}</div>

  <!-- Segment 6: server time -->
  <div class="seg">{m.status_bar_server_time({ time: serverTime })}</div>

  <!-- Right: idle status -->
  <div class="seg idle">{m.status_bar_idle()}</div>
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
