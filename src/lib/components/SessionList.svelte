<script lang="ts">
  import type { SavedConnection } from "../api/connections";
  import * as m from "#lib/paraglide/messages.js";
  import { appLocale } from "../stores/locale.svelte";
  import { relativeParts } from "../domain/recency";

  let {
    list,
    selectedId,
    onselect,
    onopen,
  }: {
    list: SavedConnection[];
    selectedId: number | null;
    onselect: (c: SavedConnection) => void;
    onopen: (c: SavedConnection) => void;
  } = $props();

  let filterText = $state("");

  const filteredList = $derived(
    filterText.trim()
      ? list.filter((c) =>
          c.label.toLowerCase().includes(filterText.toLowerCase()) ||
          c.host.toLowerCase().includes(filterText.toLowerCase())
        )
      : list,
  );

  function formatLast(c: SavedConnection): string {
    if (c.lastConnectedAt == null) return m.session_manager_last_never();
    const { value, unit } = relativeParts(c.lastConnectedAt, Date.now());
    return new Intl.RelativeTimeFormat(appLocale.current, { numeric: "auto" }).format(value, unit);
  }

  function absoluteLast(c: SavedConnection): string | undefined {
    return c.lastConnectedAt == null ? undefined : new Date(c.lastConnectedAt).toLocaleString();
  }
</script>

<div class="left-col">
  <!-- Filter bar -->
  <div class="filter-bar">
    <div class="filter-input-wrap">
      <svg aria-hidden="true" class="filter-icon" width="12" height="12" viewBox="0 0 16 16">
        <circle cx="6.5" cy="6.5" r="5" fill="none" stroke="var(--muted)" stroke-width="1.5"/>
        <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="var(--muted)" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <input
        class="filter-input"
        bind:value={filterText}
        placeholder={m.session_manager_filter_placeholder()}
        aria-label={m.session_manager_filter_aria()}
      />
    </div>
    {#if filterText}
      <button class="filter-clear" onclick={() => (filterText = "")} title={m.session_manager_filter_clear_title()}>✕</button>
    {/if}
  </div>

  <!-- Column headers -->
  <div class="list-header">
    <span class="col-name">{m.session_manager_col_name()}</span>
    <span class="col-last">{m.session_manager_col_last()}</span>
  </div>

  <!-- Session list -->
  <div class="session-list">
    {#each filteredList as c (c.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div
        class="session-row"
        class:selected={selectedId === c.id}
        onclick={() => onselect(c)}
        ondblclick={() => onopen(c)}
        title={`${c.host} — ${m.session_manager_row_connect_hint()}`}
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" class="session-icon">
          <path d="M12 2c-4 0-7 1.6-7 3.6v12.8C5 20.4 8 22 12 22s7-1.6 7-3.6V5.6C19 3.6 16 2 12 2z" fill="none" stroke={selectedId === c.id ? "var(--accent)" : "var(--muted)"} stroke-width="1.8"/>
          <ellipse cx="12" cy="5.6" rx="7" ry="3.6" fill="none" stroke={selectedId === c.id ? "var(--accent)" : "var(--muted)"} stroke-width="1.8"/>
        </svg>
        <span class="session-name">{c.label}</span>
        <span class="session-last" title={absoluteLast(c)}>{formatLast(c)}</span>
      </div>
    {/each}
    {#if filteredList.length === 0}
      <div class="session-empty">{m.session_manager_empty()}</div>
    {/if}
  </div>
</div>

<style>
  .left-col {
    width: 20.625rem;
    flex: none;
    border-right: 1px solid var(--gray-cf);
    display: flex;
    flex-direction: column;
    background: var(--panel);
  }

  /* ── Filter bar ── */
  .filter-bar {
    display: flex;
    gap: 0.375rem;
    padding: 0.5rem;
    align-items: center;
    flex: none;
  }
  .filter-input-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    height: 1.5rem;
    border: 1px solid var(--gray-c4);
    border-radius: var(--radius-sm);
    padding: 0 0.375rem;
    background: var(--panel);
    gap: 0.25rem;
  }
  .filter-icon { flex: none; }
  .filter-input {
    flex: 1;
    border: none;
    outline: none;
    font-size: var(--fs);
    background: transparent;
    color: var(--fg);
    min-width: 0;
  }
  .filter-input::placeholder { color: var(--gray-aa); }
  .filter-clear {
    width: 1.5rem;
    height: 1.5rem;
    border: 1px solid var(--gray-c4);
    border-radius: var(--radius-sm);
    background: var(--panel);
    color: var(--danger-mute);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font-size: 0.6875rem;
    flex: none;
  }
  .filter-clear:hover { background: var(--error-bg); }

  /* ── Session list rows ── */
  .list-header {
    display: flex;
    padding: 0 0.5rem 0.25rem;
    color: var(--gray-77);
    font-size: 0.6875rem;
    flex: none;
  }
  .col-name { flex: 1; }
  .col-last { width: 5.625rem; }

  .session-list {
    flex: 1;
    overflow: auto;
  }

  .session-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.3125rem 0.5rem;
    cursor: default;
    font-size: var(--fs);
    border-bottom: 1px solid var(--bg);
  }
  .session-row:hover {
    background: var(--row-hover);
  }
  .session-row.selected {
    background: var(--row-selected);
    outline: 1px solid var(--row-selected-ring);
    outline-offset: -1px;
  }
  .session-icon { flex: none; }
  .session-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session-last { width: 5.625rem; color: var(--muted); font-size: 0.6875rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session-empty { padding: 1rem 0.5rem; color: var(--muted); font-size: var(--fs); }
</style>
