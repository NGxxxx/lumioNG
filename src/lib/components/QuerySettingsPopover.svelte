<script lang="ts">
  import { settings } from "../stores/settings.svelte";
  import * as m from "#lib/paraglide/messages.js";

  /** `timeoutOnly`: the collection Data view, where only the query timeout applies
   *  (the result cap and query history belong to the Query tab). */
  let { timeoutOnly = false }: { timeoutOnly?: boolean } = $props();

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
      <label class="field">
        <span class="field-label">{m.query_tab_settings_timeout()}</span>
        <input type="number" min="1" class="field-input" value={settings.queryTimeoutMs}
          onchange={(e) => settings.setQueryTimeoutMs(+e.currentTarget.value)} />
      </label>
      {#if !timeoutOnly}
        <div class="field cap-field">
          <label class="field-label" for="query-cap-input">{m.query_tab_settings_cap()}</label>
          <input id="query-cap-input" type="number" min="1" class="field-input" value={settings.queryResultCap}
            disabled={settings.queryResultCapUnlimited}
            onchange={(e) => settings.setQueryResultCap(+e.currentTarget.value)} />
          <label class="checkbox-row">
            <input type="checkbox" checked={settings.queryResultCapUnlimited}
              onchange={(e) => settings.setQueryResultCapUnlimited(e.currentTarget.checked)} />
            <span>{m.query_tab_settings_cap_all()}</span>
          </label>
        </div>
        <label class="checkbox-row history-row">
          <input type="checkbox" checked={settings.recordQueryHistory}
            onchange={(e) => settings.setRecordQueryHistory(e.currentTarget.checked)} />
          <span>{m.settings_record_history()}</span>
        </label>
      {/if}
    </div>
  {/if}
</div>

<style>
  .settings { position: relative; display: inline-flex; }
  .gear { background: none; border: none; cursor: pointer; font-size: 0.875rem; line-height: 1; padding: 0.125rem 0.25rem; color: var(--gray-55); border-radius: var(--radius); }
  .gear:hover { background: var(--hover); color: var(--fg); }

  .popover {
    position: absolute; top: 1.75rem; right: 0; z-index: 100;
    background: var(--popover); border: 1px solid var(--c-surface1); border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    padding: 0.75rem; display: flex; flex-direction: column; gap: 0.75rem; min-width: 13rem;
  }

  /* Each setting is its own column: label above control. `.cap-field` additionally nests the
     ALL checkbox directly under its input (tight gap) since the two are one control, not two. */
  .field { display: flex; flex-direction: column; gap: 0.3125rem; }
  .field-label { font-size: 0.6875rem; font-weight: 600; color: var(--gray-55); }

  .field-input {
    height: 1.625rem; padding: 0 0.5rem; font-size: var(--fs);
    border: 1px solid var(--gray-c4); border-radius: var(--radius);
    background: var(--bg); color: var(--fg);
  }
  .field-input:focus { outline: none; border-color: var(--focus-ring); }
  .field-input:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Row selector (element + class) outweighs `.field`'s column rule so this doesn't get
     silently overridden by cascade order — see CLAUDE.md note on selector specificity. */
  label.checkbox-row {
    display: flex; flex-direction: row; align-items: center; gap: 0.375rem;
    margin-top: 0.0625rem; font-size: 0.6875rem; font-weight: var(--fw); color: var(--fg); cursor: pointer;
  }
  .checkbox-row input[type="checkbox"] {
    width: 0.8125rem; height: 0.8125rem; margin: 0; accent-color: var(--accent); cursor: pointer;
  }
</style>
