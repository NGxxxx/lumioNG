<script lang="ts">
  import { errorMessage } from "../api/errors";

  let {
    onsubmit,
    oncancel,
  }: {
    onsubmit: (db: string, coll: string) => Promise<void>;
    oncancel: () => void;
  } = $props();

  let db = $state("");
  let coll = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function submit() {
    busy = true;
    error = null;
    try {
      await onsubmit(db.trim(), coll.trim());
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && oncancel()} />

<div
  class="backdrop"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) oncancel();
  }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label="New database">
    <header>New database</header>
    <div class="body">
      <p class="hint">MongoDB tạo database khi có collection đầu tiên — nhập cả hai.</p>
      <label>Tên database<input bind:value={db} aria-label="db-input" /></label>
      <label>Collection đầu tiên<input bind:value={coll} aria-label="coll-input" /></label>
      {#if error}<div class="dlg-error">{error}</div>{/if}
    </div>
    <footer>
      <button onclick={oncancel}>Cancel</button>
      <button class="primary" disabled={busy} onclick={submit}>Create</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: #fff; width: 420px; max-width: 90vw; border-radius: 6px; overflow: hidden; }
  header { padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #eee; }
  .body { padding: 14px; font-size: 13px; }
  .hint { color: #666; margin: 0 0 10px; }
  label { display: block; margin-bottom: 10px; }
  .body input { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 5px 7px; }
  .dlg-error { color: #b71c1c; margin-top: 8px; }
  footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid #eee; }
</style>
