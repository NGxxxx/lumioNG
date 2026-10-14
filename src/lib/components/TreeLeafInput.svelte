<!-- src/lib/components/TreeLeafInput.svelte -->
<script lang="ts">
  import { nestedJsonPretty } from "../domain/extjson";
  import { editTextOf, rebuildLeaf, type LeafInputType } from "../domain/bsontree";
  import { settings } from "../stores/settings.svelte";
  import JsonPreviewDialog from "./JsonPreviewDialog.svelte";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";

  /** One editable leaf cell in the document tree editor; kept as its own component so each row's in-progress edit text is independent local state. */
  let {
    type,
    value,
    onchange,
    onerror,
  }: {
    type: LeafInputType;
    value: unknown;
    onchange: (v: unknown) => void;
    onerror: (hasError: boolean) => void;
  } = $props();

  // Offer a read-only pretty preview for a string field that's itself JSON, without touching the editable raw string.
  const nestedPretty = $derived(type === "string" && typeof value === "string" ? nestedJsonPretty(value) : null);
  let showNestedPretty = $state(false);

  // Below this length a single-line input reads fine; only longer values switch to a textarea.
  const WRAP_TEXTAREA_THRESHOLD = 100;

  let editText = $state("");
  let dirty = $state(false);
  let editError = $state<string | null>(null);

  // Sync edit text from value when value changes externally (e.g. array splice) and not mid-edit.
  $effect(() => {
    if (!dirty) editText = editTextOf(value);
  });

  function onLeafInput() {
    dirty = true;
    const r = rebuildLeaf(type, editText, { preferBare: typeof value === "number" });
    if (r.ok) {
      editError = null;
      onerror(false);
      onchange(r.value);
    } else {
      editError = r.error;
      onerror(true);
    }
  }

  // If this leaf is removed from the tree while it has an active error, clear the error flag at the root.
  $effect(() => {
    return () => {
      if (editError) onerror(false);
    };
  });

  const wrapped = $derived(type === "string" && settings.wrapLongLines && typeof value === "string" && value.length > WRAP_TEXTAREA_THRESHOLD);
</script>

{#if type === "bool"}
  <select bind:value={editText} onchange={onLeafInput}>
    <option value="true">true</option>
    <option value="false">false</option>
  </select>
{:else if wrapped}
  <textarea class="leaf leaf-wrap" bind:value={editText} oninput={onLeafInput} spellcheck="false" rows="3"></textarea>
{:else}
  <input class="leaf" bind:value={editText} oninput={onLeafInput} spellcheck="false" />
{/if}
{#if nestedPretty !== null}
  <button
    class="preview-toggle"
    class:active={showNestedPretty}
    onclick={() => (showNestedPretty = true)}
    title={m.tree_node_preview_json_title()}
    aria-label={m.tree_node_preview_json_title()}
  >{"{ }"}</button>
{/if}
{#if editError}<div class="cellerror">{msgKey(editError)}</div>{/if}
{#if nestedPretty !== null && showNestedPretty}
  <JsonPreviewDialog json={nestedPretty} onclose={() => (showNestedPretty = false)} />
{/if}

<style>
  /* flex+min-width:0: a bare input/textarea otherwise sizes to its tiny intrinsic default. */
  .leaf { flex: 1; min-width: 0; font-family: var(--mono); font-size: 0.8125rem; padding: 0.0625rem 0.25rem; }
  .leaf-wrap { resize: vertical; white-space: pre-wrap; word-break: break-word; }
  .preview-toggle {
    flex: none; border: 1px solid var(--gray-b8); background: var(--panel); color: var(--gray-55);
    border-radius: var(--radius); cursor: pointer; font-family: var(--mono); font-size: 0.6875rem;
    line-height: 1; padding: 0.0625rem 0.3125rem;
  }
  .preview-toggle:hover, .preview-toggle.active { background: var(--blue-tint5); color: var(--slate); }
  .cellerror { color: var(--error); font-size: 0.6875rem; margin-left: 0.375rem; }
</style>
