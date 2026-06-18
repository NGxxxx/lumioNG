<script lang="ts">
  import { onMount } from "svelte";
  import { createConnectionRegistry } from "../stores/connections.svelte";

  let { onconnected }: { onconnected?: () => void } = $props();
  const r = createConnectionRegistry();

  async function connectAdhoc() {
    if (await r.connectTo(r.uri)) onconnected?.();
  }
  async function connectSaved(uri: string) {
    if (await r.connectTo(uri)) onconnected?.();
  }

  onMount(() => {
    r.load();
  });
</script>

<div class="bar">
  <div class="saved">
    {#each r.list as c (c.id)}
      <span class="conn">
        <button class="connect" onclick={() => connectSaved(c.uri)} disabled={r.connecting} title={c.uri}>
          {c.label}
        </button>
        <button class="mini" onclick={() => r.edit(c)}>Edit</button>
        <button class="mini" onclick={() => r.remove(c.id)}>Delete</button>
      </span>
    {/each}
  </div>
  <div class="form">
    <input class="label" bind:value={r.label} placeholder="Tên (vd Local)" />
    <input class="uri" bind:value={r.uri} placeholder="mongodb:// hoặc mongodb+srv://" />
    <button onclick={r.save}>{r.editingId === null ? "Save" : "Update"}</button>
    {#if r.editingId !== null}<button onclick={r.clearForm}>Cancel</button>{/if}
    <button onclick={connectAdhoc} disabled={r.connecting}>
      {r.connecting ? "Đang kết nối…" : "Connect"}
    </button>
  </div>
  {#if r.formError}<span class="error">{r.formError}</span>{/if}
  {#if r.error}<span class="error">{r.error}</span>{/if}
</div>

<style>
  .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px; border-bottom: 1px solid #ddd; }
  .saved { display: flex; flex-wrap: wrap; gap: 6px; }
  .conn { display: inline-flex; align-items: center; gap: 2px; border: 1px solid #ddd; border-radius: 4px; padding: 2px; }
  .conn .connect { font-weight: 600; }
  .mini { font-size: 11px; }
  .form { display: flex; gap: 6px; align-items: center; flex: 1; }
  .label { width: 120px; padding: 6px 8px; }
  .uri { flex: 1; padding: 6px 8px; font-family: ui-monospace, monospace; }
  .error { color: #b71c1c; font-size: 12px; }
</style>
