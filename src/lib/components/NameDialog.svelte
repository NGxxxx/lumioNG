<script lang="ts">
  import { untrack } from "svelte";
  import { errorMessage } from "../api/errors";
  import { portal } from "../actions/portal";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";

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
  use:portal
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) oncancel();
  }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
    <header>{title}</header>
    <div class="body">
      <label>{label}<input bind:value aria-label="name-input" /></label>
      {#if error}<div class="dlg-error">{msgKey(error)}</div>{/if}
    </div>
    <footer>
      <button onclick={oncancel}>{m.common_cancel()}</button>
      <button class="primary" disabled={busy} onclick={submit}>{m.common_ok()}</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: #fff; width: 26.25rem; max-width: 90vw; border-radius: 0.375rem; overflow: hidden; }
  header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid #eee; }
  .body { padding: 0.875rem; font-size: 0.8125rem; }
  label { display: block; }
  .body input { width: 100%; box-sizing: border-box; margin-top: 0.375rem; padding: 0.3125rem 0.4375rem; }
  .dlg-error { color: #b71c1c; margin-top: 0.5rem; }
  footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid #eee; }
</style>
