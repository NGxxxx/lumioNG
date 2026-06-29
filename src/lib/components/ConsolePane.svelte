<script lang="ts">
  import type { ConsoleEntry } from "../api/script";
  import * as m from "$lib/paraglide/messages";

  let { entries }: { entries: ConsoleEntry[] } = $props();
</script>

{#if entries.length === 0}
  <div class="idle">{m.query_tab_status_idle()}</div>
{:else}
  <div class="console">
    {#each entries as entry, i (i)}
      <div class="entry" class:error={entry.level === "error"}>{entry.text}</div>
    {/each}
  </div>
{/if}

<style>
  .idle { padding: 0.5rem 0.75rem; color: var(--muted); font-size: 0.75rem; }
  .console { height: 100%; overflow: auto; padding: 0.25rem 0; }
  .entry {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    padding: 0.125rem 0.625rem;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--fg);
  }
  .entry.error {
    background: var(--error-bg);
    color: var(--error);
  }
</style>
