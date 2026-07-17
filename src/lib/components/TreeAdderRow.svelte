<!-- src/lib/components/TreeAdderRow.svelte -->
<script lang="ts">
  import { emptyValue, validateNewFieldName, ADDABLE_TYPES, type AddableType } from "../domain/bsontree";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";

  /** The trailing "add field"/"add item" row for an open container (own local draft state, kept
   *  independent from any sibling adder row visible elsewhere in the tree). */
  let {
    isArray,
    existingKeys,
    onadd,
  }: {
    isArray: boolean;
    existingKeys: string[];
    onadd: (name: string | null, value: unknown) => void;
  } = $props();

  let newName = $state("");
  let newType = $state<AddableType>("string");
  let addError = $state<string | null>(null);

  function addField() {
    const name = newName.trim();
    const err = validateNewFieldName(name, existingKeys);
    if (err !== null) { addError = err; return; }
    addError = null;
    onadd(name, emptyValue(newType));
    newName = "";
    newType = "string";
  }

  function addItem() {
    onadd(null, emptyValue(newType));
    newType = "string";
  }
</script>

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

<style>
  .add { display: flex; align-items: center; gap: 0.375rem; }
  .add button { border: none; background: none; color: var(--link); cursor: pointer; padding: 0; font-size: 0.75rem; }
  .add .name { font-size: 0.75rem; padding: 0.0625rem 0.25rem; }
  .adderr { color: var(--error); font-size: 0.6875rem; }
</style>
