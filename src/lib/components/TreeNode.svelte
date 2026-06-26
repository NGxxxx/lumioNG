<script lang="ts">
  import TreeNode from "./TreeNode.svelte";
  import { describeValue } from "../domain/extjson";
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
  <div class="node">
    <span class="label">{label}</span>
    <span class="badge">{type}</span>
    {#if type === "bool"}
      <select bind:value={editText} onchange={onLeafInput}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    {:else}
      <input class="leaf" bind:value={editText} oninput={onLeafInput} spellcheck="false" />
    {/if}
    {#if removable}<button class="x" onclick={onremove} aria-label={m.tree_node_remove_label()}>✕</button>{/if}
    {#if editError}<div class="cellerror">{msgKey(editError)}</div>{/if}
  </div>
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
  .label { font-family: ui-monospace, monospace; font-size: 0.8125rem; color: var(--gray-33); }
  .badge { background: var(--blue-tint5); color: var(--slate); padding: 0 0.375rem; border-radius: 0.1875rem; font-size: 0.6875rem; font-family: ui-monospace, monospace; }
  .display { color: var(--gray-55); font-family: ui-monospace, monospace; font-size: 0.8125rem; }
  .leaf { font-family: ui-monospace, monospace; font-size: 0.8125rem; padding: 0.0625rem 0.25rem; }
  .x { border: none; background: none; color: var(--danger-strong); cursor: pointer; font-size: 0.75rem; }
  .lock { font-size: 0.75rem; }
  .cellerror { color: var(--error); font-size: 0.6875rem; margin-left: 0.375rem; }
  .add { display: flex; align-items: center; gap: 0.375rem; padding: 0.125rem 0 0.125rem 1.125rem; }
  .add .name { font-size: 0.75rem; padding: 0.0625rem 0.25rem; }
  .adderr { color: var(--error); font-size: 0.6875rem; }
</style>
