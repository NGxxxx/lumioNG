<script lang="ts">
  import { connect, errorMessage } from "../ipc";

  let { onconnected }: { onconnected?: () => void } = $props();

  let uri = $state("mongodb://localhost:27017");
  let connecting = $state(false);
  let error = $state<string | null>(null);

  async function onConnect() {
    connecting = true;
    error = null;
    try {
      await connect(uri);
      onconnected?.();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      connecting = false;
    }
  }
</script>

<div class="bar">
  <input bind:value={uri} placeholder="mongodb:// hoặc mongodb+srv://" />
  <button onclick={onConnect} disabled={connecting}>{connecting ? "Đang kết nối…" : "Connect"}</button>
  {#if error}<span class="error">{error}</span>{/if}
</div>

<style>
  .bar { display: flex; gap: 8px; align-items: center; padding: 8px; border-bottom: 1px solid #ddd; }
  input { flex: 1; padding: 6px 8px; font-family: ui-monospace, monospace; }
  .error { color: #b71c1c; font-size: 12px; }
</style>
