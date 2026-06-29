<script lang="ts">
  import { settings } from "../stores/settings.svelte";
  import * as m from "$lib/paraglide/messages";

  let open = $state(false);

  function toggle(e: MouseEvent) {
    e.stopPropagation();
    open = !open;
  }
</script>

<svelte:window onclick={() => (open = false)} />

<div class="settings">
  <button class="gear" title={m.query_tab_settings()} aria-label={m.query_tab_settings()} onclick={toggle}>⚙</button>
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="popover" onclick={(e) => e.stopPropagation()}>
      <label>
        {m.query_tab_settings_timeout()}
        <input type="number" min="1" value={settings.queryTimeoutMs}
          onchange={(e) => settings.setQueryTimeoutMs(+e.currentTarget.value)} />
      </label>
      <label>
        {m.query_tab_settings_cap()}
        <input type="number" min="1" value={settings.queryResultCap}
          onchange={(e) => settings.setQueryResultCap(+e.currentTarget.value)} />
      </label>
    </div>
  {/if}
</div>

<style>
  .settings { position: relative; display: inline-flex; }
  .gear { background: none; border: none; cursor: pointer; font-size: 0.875rem; line-height: 1; padding: 0.125rem 0.25rem; color: var(--gray-55); border-radius: 0.1875rem; }
  .gear:hover { background: var(--hover); color: var(--fg); }
  .popover { position: absolute; top: 1.5rem; right: 0; z-index: 100; background: var(--panel); border: 1px solid var(--border); border-radius: 0.25rem; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18); padding: 0.5rem 0.625rem; display: flex; flex-direction: column; gap: 0.5rem; min-width: 11rem; }
  .popover label { display: flex; flex-direction: column; gap: 0.1875rem; font-size: 0.6875rem; color: var(--gray-55); }
  .popover input { height: 1.5rem; padding: 0 0.375rem; font-size: 0.75rem; border: 1px solid var(--gray-c4); border-radius: 0.125rem; background: var(--bg); color: var(--fg); }
</style>
