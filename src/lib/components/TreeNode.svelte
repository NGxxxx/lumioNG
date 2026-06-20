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

  // ----- trạng thái sửa lá -----
  let editText = $state("");
  let dirty = $state(false);
  let editError = $state<string | null>(null);

  // Đồng bộ text từ value khi value đổi từ ngoài (vd array splice) và không đang sửa dở.
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

  // Nếu lá đang lỗi mà bị gỡ khỏi cây → dọn cờ lỗi ở gốc.
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

  // ----- thêm field/phần tử -----
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
      <input class="name" placeholder="tên field…" bind:value={newName} />
    {/if}
    <select bind:value={newType}>
      {#each ADDABLE_TYPES as t}<option value={t}>{t}</option>{/each}
    </select>
    <button onclick={isArray ? addItem : addField}>{isArray ? "+ Add item" : "+ Add field"}</button>
    {#if addError}<span class="adderr">{addError}</span>{/if}
  </div>
{/snippet}

{#if root || type === "object"}
  {#if !root}
    <div class="node">
      <span class="label">{label}</span>
      <span class="badge">object</span>
      {#if removable}<button class="x" onclick={onremove} aria-label="Remove">✕</button>{/if}
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
    {#if removable}<button class="x" onclick={onremove} aria-label="Remove">✕</button>{/if}
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
    {#if removable}<button class="x" onclick={onremove} aria-label="Remove">✕</button>{/if}
    {#if editError}<div class="cellerror">{editError}</div>{/if}
  </div>
{:else}
  <div class="node">
    <span class="label">{label}</span>
    <span class="badge">{type}</span>
    <span class="display">{info.display}</span>
    {#if locked}<span class="lock" title="Bất biến">🔒</span>{/if}
    {#if removable && !locked}<button class="x" onclick={onremove} aria-label="Remove">✕</button>{/if}
  </div>
{/if}

<style>
  .tree { list-style: none; margin: 0; padding-left: 18px; border-left: 1px solid #eee; }
  .tree li { margin: 1px 0; }
  .node { display: flex; align-items: center; gap: 6px; padding: 1px 0; }
  .label { font-family: ui-monospace, monospace; font-size: 13px; color: #333; }
  .badge { background: #eef; color: #557; padding: 0 6px; border-radius: 3px; font-size: 11px; font-family: ui-monospace, monospace; }
  .display { color: #555; font-family: ui-monospace, monospace; font-size: 13px; }
  .leaf { font-family: ui-monospace, monospace; font-size: 13px; padding: 1px 4px; }
  .x { border: none; background: none; color: #c00; cursor: pointer; font-size: 12px; }
  .lock { font-size: 12px; }
  .cellerror { color: #b71c1c; font-size: 11px; margin-left: 6px; }
  .add { display: flex; align-items: center; gap: 6px; padding: 2px 0 2px 18px; }
  .add .name { font-size: 12px; padding: 1px 4px; }
  .adderr { color: #b71c1c; font-size: 11px; }
</style>
