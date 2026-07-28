<script lang="ts">
  import * as m from "$lib/paraglide/messages";

  let { inserted, failed, errors }: { inserted: number; failed: number; errors: string[] } = $props();
  let expanded = $state(false);
</script>

<div class="io-ok">{m.namespace_panel_import_done({ inserted, failed })}</div>
{#if errors.length > 0}
  <button type="button" class="link" onclick={() => (expanded = !expanded)}>
    {m.import_dialog_view_errors({ count: errors.length })}
  </button>
  {#if expanded}
    <ul class="errlist">
      {#each errors as e, i (i)}<li>{e}</li>{/each}
    </ul>
  {/if}
{/if}

<style>
  .io-ok { background: var(--ok-bg); color: var(--ok-fg); padding: 0.375rem 0.625rem; font-size: var(--fs); margin-top: 0.625rem; border-radius: 0.1875rem; }
  .link { border: none; background: none; color: var(--link-strong); cursor: pointer; padding: 0; font-size: var(--fs); margin-top: 0.5rem; }
  .link:hover { text-decoration: underline; }
  .errlist { margin: 0.375rem 0 0; padding-left: 1.125rem; max-height: 8rem; overflow: auto; font-size: var(--fs); color: var(--error); }
</style>
