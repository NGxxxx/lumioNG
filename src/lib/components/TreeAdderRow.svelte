<!-- src/lib/components/TreeAdderRow.svelte -->
<script lang="ts">
  import { emptyValue, validateNewFieldName, ADDABLE_TYPES, type AddableType } from "../domain/bsontree";
  import type { OpEntry } from "../domain/mongoOps";
  import SuggestInput from "./SuggestInput.svelte";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";

  /** The trailing "add field"/"add item" row for an open container (own local draft state, kept
   *  independent from any sibling adder row visible elsewhere in the tree). */
  let {
    isArray,
    existingKeys,
    onadd,
    fieldSuggestions = [],
    operatorSuggestions = [],
  }: {
    isArray: boolean;
    existingKeys: string[];
    onadd: (name: string | null, value: unknown) => void;
    /** Field names sampled from the collection, offered alongside operator suggestions. */
    fieldSuggestions?: string[];
    /** Pipeline Builder operator suggestions (e.g. $gt, $sum) for this row's position — empty for
     *  ordinary document editing, which never passes this. */
    operatorSuggestions?: OpEntry[];
  } = $props();

  // Already-existing keys are a dead end: validateNewFieldName() below rejects them as duplicates.
  const usableSuggestions = $derived(fieldSuggestions.filter((n) => !existingKeys.includes(n)));
  const suggestions = $derived<OpEntry[]>([
    ...usableSuggestions.map((label) => ({ label })),
    ...operatorSuggestions,
  ]);

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
    <SuggestInput
      class="name"
      placeholder={m.tree_node_field_name_placeholder()}
      value={newName}
      onInput={(v) => (newName = v)}
      {suggestions}
    />
  {/if}
  <select bind:value={newType}>
    {#each ADDABLE_TYPES as t}<option value={t}>{t}</option>{/each}
  </select>
  <button onclick={isArray ? addItem : addField}>{isArray ? m.tree_node_add_item() : m.tree_node_add_field()}</button>
  {#if addError}<span class="adderr">{msgKey(addError)}</span>{/if}
</div>

<style>
  .add { display: flex; align-items: center; gap: 0.375rem; }
  .add button { border: none; background: none; color: var(--link); cursor: pointer; padding: 0; font-size: var(--fs); }
  /* :global — "name" now lives on an <input> rendered inside SuggestInput.svelte, a different
     component, so Svelte's per-component CSS scoping needs an explicit escape hatch to reach it. */
  .add :global(.name) { font-size: var(--fs); padding: 0.0625rem 0.25rem; }
  .adderr { color: var(--error); font-size: 0.6875rem; }
</style>
