<!-- src/lib/components/StatusBar.svelte -->
<script lang="ts">
  let {
    connected,
    connectionLabel,
    dbCount,
    collCount,
    selDb,
    selColl,
  }: {
    connected: boolean;
    connectionLabel: string | null;
    dbCount: number;
    collCount: number;
    selDb: string | null;
    selColl: string | null;
  } = $props();

  const label = $derived(selDb ?? connectionLabel ?? "—");
</script>

<div class="statusbar">
  <!-- Segment 1: db/collection context -->
  <div class="seg">
    <span class="dot" class:on={connected}></span>
    {#if connected}
      {label} · {collCount} collections
    {:else}
      Disconnected
    {/if}
  </div>

  <!-- Segment 2: cell position placeholder -->
  <div class="seg">—:—</div>

  <!-- Segment 3: connected time placeholder -->
  <div class="seg">Connected: —</div>

  <!-- Segment 4: MongoDB version placeholder -->
  <div class="seg">MongoDB —</div>

  <!-- Segment 5: uptime placeholder -->
  <div class="seg">Uptime: —</div>

  <!-- Segment 6: server time placeholder -->
  <div class="seg">Server time: —</div>

  <!-- Right: idle status -->
  <div class="seg idle">Idle.</div>
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
