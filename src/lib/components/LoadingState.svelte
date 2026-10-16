<!-- Shown in place of an empty result while the first page is still loading, so a slow collection
     never reads as "No results". After a few seconds it says how long it has been waiting. -->
<script lang="ts">
  import { onMount } from "svelte";
  import * as m from "#lib/paraglide/messages.js";

  const SLOW_AFTER_S = 3;
  let seconds = $state(0);
  onMount(() => {
    const t = setInterval(() => (seconds += 1), 1000);
    return () => clearInterval(t);
  });
</script>

<div class="loading-state" role="status" aria-live="polite">
  <span class="spinner" aria-hidden="true"></span>
  <span class="title">{m.loading_documents()}</span>
  {#if seconds >= SLOW_AFTER_S}
    <span class="hint">{m.loading_documents_slow({ seconds })}</span>
  {/if}
</div>

<style>
  .loading-state {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.5rem;
    min-height: 10rem; height: 100%; padding: 1rem; box-sizing: border-box; color: var(--muted); font-size: var(--fs); text-align: center;
  }
  .title { color: var(--fg); font-weight: 500; }
  .hint { max-width: 28rem; font-size: 0.75rem; line-height: 1.45; }
  .spinner {
    width: 1.125rem; height: 1.125rem; border: 2px solid var(--accent); border-right-color: transparent;
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
