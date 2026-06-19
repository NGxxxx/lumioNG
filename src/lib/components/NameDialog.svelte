<script lang="ts">
  import { untrack } from "svelte";
  import { errorMessage } from "../api/errors";

  let {
    title,
    label,
    initial = "",
    onsubmit,
    oncancel,
  }: {
    title: string;
    label: string;
    initial?: string;
    onsubmit: (value: string) => Promise<void>;
    oncancel: () => void;
  } = $props();

  let value = $state(untrack(() => initial));
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function submit() {
    busy = true;
    error = null;
    try {
      await onsubmit(value.trim());
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
  <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
    <header>{title}</header>
    <div class="body">
      <label>{label}<input bind:value aria-label="name-input" /></label>
      {#if error}<div class="dlg-error">{error}</div>{/if}
    </div>
    <footer>
      <button onclick={oncancel}>Cancel</button>
      <button class="primary" disabled={busy} onclick={submit}>OK</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: #fff; width: 420px; max-width: 90vw; border-radius: 6px; overflow: hidden; }
  header { padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #eee; }
  .body { padding: 14px; font-size: 13px; }
  label { display: block; }
  .body input { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 5px 7px; }
  .dlg-error { color: #b71c1c; margin-top: 8px; }
  footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid #eee; }
</style>
