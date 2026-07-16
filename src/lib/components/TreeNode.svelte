<script lang="ts">
  import TreeNode from "./TreeNode.svelte";
  import { describeValue, nestedJsonPretty } from "../domain/extjson";
  import {
    editTextOf,
    rebuildLeaf,
    emptyValue,
    hasInput,
    validateNewFieldName,
    ADDABLE_TYPES,
    type LeafInputType,
    type AddableType,
  } from "../domain/bsontree";
  import { settings } from "../stores/settings.svelte";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";

  let {
    label,
    value,
    path,
    locked = false,
    removable = true,
    lockedKeys = [],
    root = false,
    onchange,
    onremove,
    onerror,
  }: {
    label: string;
    value: unknown;
    path: string;
    locked?: boolean;
    removable?: boolean;
    lockedKeys?: string[];
    root?: boolean;
    onchange: (v: unknown) => void;
    onremove: () => void;
    onerror: (path: string, hasError: boolean) => void;
  } = $props();

  const info = $derived(describeValue(value));
  const type = $derived(info.type);

  // Offer a read-only pretty preview for a string field that's itself JSON, without touching the editable raw string.
  const nestedPretty = $derived(type === "string" && typeof value === "string" ? nestedJsonPretty(value) : null);
  let showNestedPretty = $state(false);

  // Below this length a single-line input reads fine; only longer values switch to a textarea.
  const WRAP_TEXTAREA_THRESHOLD = 100;

  // ----- leaf edit state -----
  let editText = $state("");
  let dirty = $state(false);
  let editError = $state<string | null>(null);

  // Sync edit text from value when value changes externally (e.g. array splice) and not mid-edit.
  $effect(() => {
    if (hasInput(type) && !dirty) editText = editTextOf(value);
  });

  function onLeafInput() {
    dirty = true;
    const r = rebuildLeaf(type as LeafInputType, editText);
    if (r.ok) {
      editError = null;
      dirty = false;
      onerror(path, false);
      onchange(r.value);
    } else {
      editError = r.error;
      onerror(path, true);
    }
  }

  // If a leaf with an active error is removed from the tree, clear the error flag at the root.
  $effect(() => {
    return () => {
      if (editError) onerror(path, false);
    };
  });

  // ----- helper -----
  function childPath(seg: string | number): string {
    return path === "" ? String(seg) : `${path}.${seg}`;
  }

  function objectEntries(): [string, unknown][] {
    return Object.entries(value as Record<string, unknown>);
  }
  function setKey(k: string, nv: unknown) {
    onchange({ ...(value as Record<string, unknown>), [k]: nv });
  }
  function removeKey(k: string) {
    const c = { ...(value as Record<string, unknown>) };
    delete c[k];
    onchange(c);
  }

  function arrayItems(): unknown[] {
    return value as unknown[];
  }
  function setIndex(i: number, nv: unknown) {
    const c = [...(value as unknown[])];
    c[i] = nv;
    onchange(c);
  }
  function removeIndex(i: number) {
    const c = [...(value as unknown[])];
    c.splice(i, 1);
    onchange(c);
  }

  // ----- add field / array item -----
  let newName = $state("");
  let newType = $state<AddableType>("string");
  let addError = $state<string | null>(null);

  function addField() {
    const name = newName.trim();
    const err = validateNewFieldName(name, Object.keys(value as Record<string, unknown>));
    if (err !== null) { addError = err; return; }
    addError = null;
    onchange({ ...(value as Record<string, unknown>), [name]: emptyValue(newType) });
    newName = "";
    newType = "string";
  }

  function addItem() {
    onchange([...(value as unknown[]), emptyValue(newType)]);
    newType = "string";
  }
</script>

{#snippet adder(isArray: boolean)}
  <div class="add">
    {#if !isArray}
      <input class="name" placeholder={m.tree_node_field_name_placeholder()} bind:value={newName} />
    {/if}
    <select bind:value={newType}>
      {#each ADDABLE_TYPES as t}<option value={t}>{t}</option>{/each}
    </select>
    <button onclick={isArray ? addItem : addField}>{isArray ? m.tree_node_add_item() : m.tree_node_add_field()}</button>
    {#if addError}<span class="adderr">{msgKey(addError)}</span>{/if}
  </div>
{/snippet}

{#if root || type === "object"}
  {#if !root}
    <div class="node">
      <span class="label">{label}</span>
      <span class="badge">object</span>
      {#if removable}<button class="x" onclick={onremove} aria-label={m.tree_node_remove_label()}>✕</button>{/if}
    </div>
  {/if}
  <ul class="tree">
    {#each objectEntries() as [k, v] (k)}
      <li>
        <TreeNode
          label={k}
          value={v}
          path={childPath(k)}
          locked={lockedKeys.includes(k)}
          removable={!lockedKeys.includes(k)}
          onchange={(nv) => setKey(k, nv)}
          onremove={() => removeKey(k)}
          {onerror}
        />
      </li>
    {/each}
  </ul>
  {@render adder(false)}
{:else if type === "array"}
  <div class="node">
    <span class="label">{label}</span>
    <span class="badge">array[{arrayItems().length}]</span>
    {#if removable}<button class="x" onclick={onremove} aria-label={m.tree_node_remove_label()}>✕</button>{/if}
  </div>
  <ul class="tree">
    {#each arrayItems() as v, i (i)}
      <li>
        <TreeNode
          label={`[${i}]`}
          value={v}
          path={childPath(i)}
          onchange={(nv) => setIndex(i, nv)}
          onremove={() => removeIndex(i)}
          {onerror}
        />
      </li>
    {/each}
  </ul>
  {@render adder(true)}
{:else if hasInput(type) && !locked}
  {@const wrapped = type === "string" && settings.wrapLongLines && typeof value === "string" && value.length > WRAP_TEXTAREA_THRESHOLD}
  <div class="node" class:node-wrap={wrapped}>
    <span class="label">{label}</span>
    <span class="badge">{type}</span>
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
        onclick={() => (showNestedPretty = !showNestedPretty)}
        title={m.tree_node_preview_json_title()}
        aria-label={m.tree_node_preview_json_title()}
      >{"{ }"}</button>
    {/if}
    {#if removable}<button class="x" onclick={onremove} aria-label={m.tree_node_remove_label()}>✕</button>{/if}
    {#if editError}<div class="cellerror">{msgKey(editError)}</div>{/if}
  </div>
  {#if nestedPretty !== null && showNestedPretty}
    <pre class="nested-preview">{nestedPretty}</pre>
  {/if}
{:else}
  <div class="node">
    <span class="label">{label}</span>
    <span class="badge">{type}</span>
    <span class="display">{info.display}</span>
    {#if locked}<span class="lock" title={m.tree_node_locked_title()}>🔒</span>{/if}
    {#if removable && !locked}<button class="x" onclick={onremove} aria-label={m.tree_node_remove_label()}>✕</button>{/if}
  </div>
{/if}

<style>
  .tree { list-style: none; margin: 0; padding-left: 1.125rem; border-left: 1px solid var(--bg); }
  .tree li { margin: 0.0625rem 0; }
  .node { display: flex; align-items: center; gap: 0.375rem; padding: 0.0625rem 0; }
  /* Top-align a wrapped (multi-line textarea) row instead of centering it. */
  .node-wrap { align-items: flex-start; }
  .label { font-family: ui-monospace, monospace; font-size: 0.8125rem; color: var(--gray-33); flex: none; }
  .badge { background: var(--blue-tint5); color: var(--slate); padding: 0 0.375rem; border-radius: 0.1875rem; font-size: 0.6875rem; font-family: ui-monospace, monospace; flex: none; }
  .display { color: var(--gray-55); font-family: ui-monospace, monospace; font-size: 0.8125rem; }
  /* flex+min-width:0: a bare input/textarea otherwise sizes to its tiny intrinsic default. */
  .leaf { flex: 1; min-width: 0; font-family: ui-monospace, monospace; font-size: 0.8125rem; padding: 0.0625rem 0.25rem; }
  .leaf-wrap { resize: vertical; white-space: pre-wrap; word-break: break-word; }
  .x { border: none; background: none; color: var(--danger-strong); cursor: pointer; font-size: 0.75rem; }
  .preview-toggle {
    flex: none; border: 1px solid var(--gray-b8); background: var(--panel); color: var(--gray-55);
    border-radius: 0.1875rem; cursor: pointer; font-family: ui-monospace, monospace; font-size: 0.6875rem;
    line-height: 1; padding: 0.0625rem 0.3125rem;
  }
  .preview-toggle:hover, .preview-toggle.active { background: var(--blue-tint5); color: var(--slate); }
  .nested-preview {
    margin: 0.125rem 0 0.25rem 1.125rem; padding: 0.375rem 0.5rem; background: var(--bg);
    border: 1px solid var(--border); border-radius: 0.1875rem; font-family: ui-monospace, monospace;
    font-size: 0.75rem; white-space: pre-wrap; word-break: break-word; color: var(--gray-33);
  }
  .lock { font-size: 0.75rem; }
  .cellerror { color: var(--error); font-size: 0.6875rem; margin-left: 0.375rem; }
  .add { display: flex; align-items: center; gap: 0.375rem; padding: 0.125rem 0 0.125rem 1.125rem; }
  .add button { border: none; background: none; color: var(--link); cursor: pointer; padding: 0; font-size: 0.75rem; }
  .add .name { font-size: 0.75rem; padding: 0.0625rem 0.25rem; }
  .adderr { color: var(--error); font-size: 0.6875rem; }
</style>
