<!-- src/lib/components/SuggestInput.svelte -->
<script lang="ts">
  import type { OpEntry } from "../domain/mongoOps";

  /** Shared type-ahead input: a controlled text field plus a floating, keyboard-navigable
   *  suggestion listbox. Replaces every native `<datalist>` in the project — a datalist can't show
   *  a per-suggestion description, which is the whole point of using this for e.g. pipeline
   *  operator suggestions (label + what the operator does). */
  let {
    value,
    suggestions,
    onInput,
    placeholder = "",
    id,
    class: className = "",
    disabled = false,
  }: {
    value: string;
    suggestions: OpEntry[];
    onInput: (v: string) => void;
    placeholder?: string;
    id?: string;
    class?: string;
    disabled?: boolean;
  } = $props();

  let inputEl = $state<HTMLInputElement | null>(null);
  let open = $state(false);
  let activeIndex = $state(-1);
  let rect = $state<{ left: number; top: number; width: number } | null>(null);

  const filtered = $derived.by((): OpEntry[] => {
    const q = value.trim().toLowerCase();
    if (q === "") return suggestions;
    return suggestions.filter((s) => s.label.toLowerCase().startsWith(q));
  });

  function openPopup() {
    if (!inputEl || suggestions.length === 0) return;
    const r = inputEl.getBoundingClientRect();
    rect = { left: r.left, top: r.bottom, width: r.width };
    open = true;
    activeIndex = -1;
  }
  function closePopup() {
    open = false;
    activeIndex = -1;
  }

  function select(s: OpEntry) {
    onInput(s.label);
    closePopup();
  }

  function onKeydown(e: KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown") openPopup();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length > 0) activeIndex = (activeIndex + 1) % filtered.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length > 0) activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && filtered[activeIndex]) {
        e.preventDefault();
        select(filtered[activeIndex]);
      } else {
        closePopup();
      }
    } else if (e.key === "Escape") {
      closePopup();
    }
  }

  // Ancestor scroll (e.g. TreeAdderRow living inside TreeEditor's virtualized, overflow:auto row
  // list) must close the popup — a position:fixed popup anchored to a stale rect would otherwise
  // visibly detach from its input. `scroll` doesn't bubble, so this needs capture:true to see
  // scroll events from inner scrollable containers, not just window-level scrolling.
  $effect(() => {
    if (!open) return;
    const onScroll = () => closePopup();
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  });

  const listId = `suggest-list-${Math.random().toString(36).slice(2)}`;
</script>

<input
  bind:this={inputEl}
  {id}
  class={className}
  type="text"
  role="combobox"
  aria-expanded={open}
  aria-controls={listId}
  aria-autocomplete="list"
  autocomplete="off"
  {placeholder}
  {disabled}
  {value}
  oninput={(e) => { onInput((e.currentTarget as HTMLInputElement).value); openPopup(); }}
  onfocus={openPopup}
  onblur={closePopup}
  onkeydown={onKeydown}
/>
{#if open && filtered.length > 0 && rect}
  <ul class="suggest-list" id={listId} role="listbox" style="left:{rect.left}px; top:{rect.top}px; width:{rect.width}px">
    {#each filtered as s, i (s.label)}
      <li role="option" aria-selected={i === activeIndex}>
        <button
          type="button"
          class="suggest-option"
          class:active={i === activeIndex}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => select(s)}
        >
          <span class="suggest-label">{s.label}</span>
          {#if s.detail}<span class="suggest-detail">{s.detail}</span>{/if}
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  input {
    font-family: inherit;
    font-size: var(--fs);
    padding: 0.0625rem 0.25rem;
    border: 1px solid var(--gray-b8);
    border-radius: 0.1875rem;
    background: var(--panel);
    color: var(--fg);
  }
  input:focus {
    outline: none;
    border-color: var(--focus-ring);
  }
  .suggest-list {
    position: fixed;
    z-index: 1000;
    margin: 0;
    padding: 0.25rem 0;
    list-style: none;
    background: var(--panel);
    border: 1px solid var(--gray-c4);
    border-radius: 0.25rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
    max-height: 16rem;
    overflow-y: auto;
  }
  .suggest-option {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    color: var(--fg);
    padding: 0.25rem 0.75rem;
    font-size: 0.8125rem;
    font-family: ui-monospace, monospace;
    cursor: pointer;
  }
  .suggest-option:hover, .suggest-option.active { background: var(--bg); }
  .suggest-label { flex: none; }
  .suggest-detail { color: var(--muted); font-size: 0.6875rem; font-family: inherit; }
</style>
