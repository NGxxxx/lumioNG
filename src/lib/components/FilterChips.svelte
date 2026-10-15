<!-- src/lib/components/FilterChips.svelte — the Data tab's filter as removable condition chips, a quick-syntax input, and the recent-filters menu. Rendering only; parsing lives in domain/filterChips + chipText, state in collectionView. -->
<script lang="ts">
  import { parseQuickChip, chipsFromFilter, canJoinOr, joinOr, type Chip } from "../domain/filterChips";
  import type { FieldInfo } from "../domain/fieldInfo";
  import type { FilterHistoryEntry } from "../domain/filterHistory";
  import { chipParts } from "../domain/chipText";
  import { chipOpLabel } from "./chipOpLabel";
  import ChipEditor from "./ChipEditor.svelte";
  import { clickOutside } from "../actions/clickOutside";
  import * as m from "#lib/paraglide/messages.js";

  let {
    chips,
    fields,
    valuesFor,
    slowHint,
    zero,
    history,
    onchange,
    onhistory,
    onpin,
    onclearhistory,
  }: {
    chips: Chip[];
    fields: FieldInfo[];
    valuesFor: (path: string) => string[];
    slowHint: (path: string) => boolean;
    /** The applied filter matches nothing. */
    zero: boolean;
    history: FilterHistoryEntry[];
    onchange: (chips: Chip[]) => void;
    onhistory: (text: string) => void;
    onpin: (text: string, pinned: boolean) => void;
    onclearhistory: () => void;
  } = $props();

  let quick = $state("");
  let quickError = $state(false);
  // null = closed; -1 = adding; i = editing chip i
  let editing = $state<number | null>(null);
  let historyOpen = $state(false);
  let quickEl: HTMLInputElement | undefined = $state();

  const typeOf = (path: string) => fields.find((f) => f.path === path)?.type ?? "unknown";

  function remove(i: number) {
    onchange(chips.filter((_, j) => j !== i));
  }

  function save(chip: Chip) {
    const i = editing;
    editing = null;
    onchange(i === null || i < 0 ? [...chips, chip] : chips.map((c, j) => (j === i ? chip : c)));
    quickEl?.focus();
  }

  function onQuickKey(e: KeyboardEvent) {
    if (e.key === "Backspace" && quick === "" && chips.length) {
      e.preventDefault();
      remove(chips.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const text = quick.trim();
      if (!text) return void (editing = -1);
      const chip = parseQuickChip(text, typeOf);
      if (chip) {
        onchange([...chips, chip]);
        quick = "";
      } else if (fields.some((f) => f.path === text)) {
        editing = -1;
      } else {
        quickError = true;
      }
    } else if (e.key === "ArrowDown" && quick === "") {
      e.preventDefault();
      editing = -1;
    }
  }

  function historyLabel(text: string): string {
    const cs = chipsFromFilter(text);
    if (!cs) return text;
    return cs.map((c) => { const p = chipParts(c); return `${p.field} ${chipOpLabel(p.op, typeOf(p.field))} ${p.value}`.trim(); }).join(" · ");
  }

  function ago(at: number): string {
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
  }
</script>

<div class="chips" use:clickOutside={() => { editing = null; historyOpen = false; }}>
  {#each chips as c, i (i)}
    {@const p = chipParts(c)}
    <span class="chip" class:zero={zero && i === chips.length - 1}>
      <button type="button" class="chip-body" onclick={() => (editing = i)} title={slowHint(c.field) ? m.chips_slow() : undefined}>
        {#if slowHint(c.field)}<span class="slow" aria-label={m.chips_slow()}></span>{/if}
        <span class="f">{p.field}</span>
        <span class="o">{chipOpLabel(p.op, typeOf(p.field))}</span>
        {#if p.value}<span class="v">{p.value}</span>{/if}
      </button>
      <button type="button" class="x" aria-label={m.chips_remove()} onclick={() => remove(i)}>×</button>
    </span>
    {#if chips[i + 1] && canJoinOr(c, chips[i + 1])}
      <button type="button" class="or" title={m.chips_or_title()} onclick={() => onchange(joinOr(chips, i))}>{m.chips_or()}</button>
    {/if}
  {/each}
  <input
    bind:this={quickEl}
    class="quick"
    class:bad={quickError}
    bind:value={quick}
    placeholder={chips.length ? m.chips_add() : `${m.chips_add()} — ${m.chips_add_hint()}`}
    aria-label={m.chips_add()}
    title={quickError ? m.chips_quick_invalid() : m.chips_add_hint()}
    oninput={() => (quickError = false)}
    onkeydown={onQuickKey}
    spellcheck="false"
    autocomplete="off"
  />
  {#if zero}<span class="zero-note">⚠ {m.chips_zero()}</span>{/if}
  <button type="button" class="hist" aria-label={m.chips_history()} title={m.chips_history()} aria-expanded={historyOpen} onclick={() => (historyOpen = !historyOpen)}>
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></svg>
  </button>

  {#if editing !== null}
    <ChipEditor {fields} {valuesFor} initial={editing >= 0 ? chips[editing] : null} onsave={save} oncancel={() => { editing = null; quickEl?.focus(); }} />
  {/if}

  {#if historyOpen}
    <div class="history" role="menu" aria-label={m.chips_history()}>
      {#if history.length === 0}
        <div class="empty">{m.chips_history_empty()}</div>
      {:else}
        {#each history as h (h.text)}
          <div class="h-row">
            <button type="button" role="menuitem" class="h-apply" onclick={() => { historyOpen = false; onhistory(h.text); }}>
              <span class="h-label">{historyLabel(h.text)}</span>
              <span class="h-ago">{ago(h.at)}</span>
            </button>
            <button type="button" class="h-pin" class:on={h.pinned} aria-pressed={h.pinned} aria-label={h.pinned ? m.chips_unpin() : m.chips_pin()} onclick={() => onpin(h.text, !h.pinned)}>📌</button>
          </div>
        {/each}
        <button type="button" class="h-clear" onclick={() => { historyOpen = false; onclearhistory(); }}>{m.chips_history_clear()}</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .chips {
    position: relative; flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem;
    min-height: 1.875rem; padding: 0.125rem 0.25rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--bg);
  }
  .chips:focus-within { border-color: var(--accent); }
  .chip { display: inline-flex; align-items: center; border-radius: var(--radius-sm); background: var(--menu-hover); box-shadow: inset 0 0 0 1px var(--c-surface1); }
  .chip.zero { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warn) 60%, transparent); }
  .chip-body { display: inline-flex; align-items: center; gap: 0.3125rem; padding: 0.125rem 0.375rem; border: none; background: none; color: var(--fg); font-size: 0.75rem; cursor: pointer; }
  .f { font-family: var(--mono); }
  .o { color: var(--muted); }
  .v { font-family: var(--mono); color: var(--j-string, var(--fg)); max-width: 14rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .slow { width: 0.375rem; height: 0.375rem; border-radius: 50%; background: var(--warn); }
  .x { border: none; background: none; color: var(--muted); cursor: pointer; padding: 0 0.3125rem; font-size: 0.875rem; line-height: 1; }
  .x:hover { color: var(--fg); }
  .or { height: 1.25rem; padding: 0 0.375rem; border: 1px dashed var(--c-surface1); border-radius: var(--radius-sm); background: none; color: var(--muted); font-size: 0.6875rem; cursor: pointer; }
  .or:hover { border-style: solid; color: var(--fg); }
  .quick { flex: 1; min-width: 9rem; height: 1.5rem; border: none; outline: none; background: none; color: var(--fg); font-family: var(--mono); font-size: var(--fs); }
  .quick.bad { text-decoration: underline wavy var(--error); }
  .zero-note { color: var(--warn-fg); font-size: 0.6875rem; white-space: nowrap; }
  .hist { display: inline-flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem; border: none; border-radius: var(--radius-sm); background: none; color: var(--muted); cursor: pointer; }
  .hist:hover { background: var(--menu-hover); color: var(--fg); }
  .history {
    position: absolute; top: calc(100% + 0.375rem); right: 0; z-index: 40; width: min(28rem, 90vw); max-height: 20rem; overflow: auto;
    padding: 0.25rem; border: 1px solid var(--c-surface1); border-radius: var(--radius-lg); background: var(--popover); box-shadow: var(--shadow-sm);
  }
  .empty { padding: 0.5rem; color: var(--muted); font-size: 0.75rem; }
  .h-row { display: flex; align-items: center; }
  .h-apply { flex: 1; min-width: 0; display: flex; justify-content: space-between; gap: 0.75rem; padding: 0.3125rem 0.5rem; border: none; border-radius: var(--radius-sm); background: none; color: var(--fg); cursor: pointer; text-align: left; }
  .h-apply:hover { background: var(--menu-hover); }
  .h-label { font-family: var(--mono); font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .h-ago { color: var(--muted); font-size: 0.6875rem; flex: none; }
  .h-pin { border: none; background: none; cursor: pointer; opacity: 0.3; font-size: 0.75rem; }
  .h-pin.on, .h-pin:hover { opacity: 1; }
  .h-clear { margin-top: 0.25rem; width: 100%; padding: 0.3125rem; border: none; border-top: 1px solid var(--border); background: none; color: var(--muted); font-size: 0.75rem; cursor: pointer; }
</style>
