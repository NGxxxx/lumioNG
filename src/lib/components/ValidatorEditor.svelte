<!-- src/lib/components/ValidatorEditor.svelte — visual $jsonSchema editor: field tree + property form, JSON tab synced both ways. Rendering only; state lives in stores/validatorEditor. -->
<script lang="ts">
  import type { createValidatorEditor } from "../stores/validatorEditor.svelte";
  import { numFromExt } from "../domain/extjson";
  import { flattenTree, getAt, BSON_TYPES, ITEMS, type NodePath } from "../domain/jsonSchemaModel";
  import DestructiveDialog from "./DestructiveDialog.svelte";
  import { msgCount } from "#lib/msgkey.js";
  import * as m from "#lib/paraglide/messages.js";

  let { ed, saving, saveError, oncancel, onopenviolators }: {
    ed: ReturnType<typeof createValidatorEditor>;
    saving: boolean;
    saveError: string | null;
    oncancel: () => void;
    onopenviolators: (statement: string) => void;
  } = $props();

  let tab = $state<"tree" | "json">("tree");
  let selected = $state<NodePath>([]);
  let newName = $state("");
  let enumText = $state("");
  let enumError = $state(false);

  const rows = $derived(flattenTree(ed.root));
  const node = $derived(getAt(ed.root, selected) ?? ed.root);
  const parentPath = $derived(selected.slice(0, -1));
  const leaf = $derived(selected.at(-1));
  const isItems = $derived(leaf === ITEMS);
  const parentNode = $derived(getAt(ed.root, parentPath));
  const extraKeys = $derived(Object.keys(node.extra));
  const key = (p: NodePath) => p.join("\u0000");

  // Re-seed the enum box when another field is selected or the tree changes under it.
  $effect(() => {
    enumText = node.enum ? JSON.stringify(node.enum) : "";
    enumError = false;
  });

  function select(p: NodePath) {
    selected = p;
  }
  function addField() {
    const name = newName.trim();
    if (!name) return;
    ed.addField(selected, name);
    newName = "";
  }
  function toggleType(t: string, on: boolean) {
    const next = on ? [...node.bsonType, t] : node.bsonType.filter((x) => x !== t);
    ed.update(selected, { bsonType: next });
  }
  function numPatch(field: "minimum" | "maximum" | "minLength" | "maxLength", raw: string) {
    const n = raw.trim() === "" ? undefined : Number(raw);
    if (n !== undefined && Number.isNaN(n)) return;
    ed.update(selected, { [field]: n });
  }
  function strPatch(field: "pattern" | "description", raw: string) {
    ed.update(selected, { [field]: raw === "" ? undefined : raw });
  }
  function enumPatch(raw: string) {
    enumText = raw;
    if (raw.trim() === "") { enumError = false; ed.update(selected, { enum: undefined }); return; }
    try {
      const v: unknown = JSON.parse(raw);
      if (!Array.isArray(v)) throw new Error();
      enumError = false;
      ed.update(selected, { enum: v });
    } catch { enumError = true; }
  }
  function remove() {
    if (!leaf || isItems) return;
    ed.removeField(parentPath, leaf);
    selected = parentPath;
  }
  function rename(to: string) {
    if (!leaf || isItems || !to.trim() || to === leaf) return;
    ed.renameField(parentPath, leaf, to.trim());
    selected = [...parentPath, to.trim()];
  }
</script>

<div class="ve">
  <div class="ve-bar">
    <div class="ve-tabs" role="tablist">
      <button role="tab" aria-selected={tab === "tree"} class:on={tab === "tree"} onclick={() => (tab = "tree")}>{m.validator_editor_tab_tree()}</button>
      <button role="tab" aria-selected={tab === "json"} class:on={tab === "json"} onclick={() => (tab = "json")}>{m.validator_editor_tab_json()}</button>
    </div>
    <button class="from-sample" onclick={() => ed.createFromSample()} disabled={ed.busy !== null || ed.locked || !!ed.loadError}>{m.validator_editor_from_sample()}</button>
    <button class="test" onclick={() => ed.testOnData()} disabled={ed.busy !== null || !!ed.jsonError}>{m.validator_editor_test()}</button>
  </div>

  {#if ed.violators !== null}
    <div class="ve-result" class:bad={ed.violators > 0}>
      {#if ed.violators === 0}{m.validator_editor_no_violators()}{:else}{msgCount("validator_editor_violators", ed.violators)}{/if}
      {#if ed.violators > 0}
        <button class="open-violators" onclick={() => onopenviolators(ed.violatorsStatement())}>{m.validator_editor_open_violators()}</button>
      {/if}
    </div>
  {/if}
  {#if ed.error}<div class="error">{ed.error}</div>{/if}
  {#if ed.loadError}<div class="error load-error">{m.validator_editor_load_error({ message: ed.loadError })}</div>{/if}
  {#if ed.locked}<div class="muted locked-note">{m.validator_editor_locked()}</div>{/if}

  {#if tab === "tree"}
    <fieldset class="ve-body" disabled={ed.locked || !!ed.loadError}>
      <ul class="tree" role="tree">
        <li role="treeitem" aria-selected={selected.length === 0}>
          <button class="row" class:sel={selected.length === 0} onclick={() => select([])}>{m.validator_editor_root()}</button>
        </li>
        {#each rows as r (key(r.path))}
          <li role="treeitem" aria-selected={key(r.path) === key(selected)} style:padding-left="{(r.depth + 1) * 0.875}rem">
            <button class="row" class:sel={key(r.path) === key(selected)} onclick={() => select(r.path)}>
              <span class="nm">{r.name === ITEMS ? m.validator_editor_items() : r.name}</span>
              <span class="ty">{r.node.bsonType.join(" | ")}</span>
              {#if r.required}<span class="req" title={m.validator_editor_required()}>*</span>{/if}
            </button>
          </li>
        {/each}
        {#if rows.length === 0}<li class="muted pad">{m.validator_editor_empty()}</li>{/if}
      </ul>

      <div class="props">
        {#if !isItems}
          <label class="add">
            <input class="new-field" placeholder={m.validator_editor_field_name()} bind:value={newName}
              onkeydown={(e) => { if (e.key === "Enter") addField(); }} />
            <button class="add-field" onclick={addField} disabled={!newName.trim()}>{m.validator_editor_add_field()}</button>
          </label>
        {/if}
        {#if leaf && !isItems}
          <label>{m.validator_editor_field_name()}
            <input class="f-name" value={leaf} onchange={(e) => rename(e.currentTarget.value)} />
          </label>
          <label class="inline"><input type="checkbox" class="f-required" checked={parentNode?.required.includes(leaf) ?? false}
            onchange={(e) => ed.setRequired(parentPath, leaf, e.currentTarget.checked)} /> {m.validator_editor_required()}</label>
        {/if}
        <fieldset class="types">
          <legend>{m.validator_editor_types()}</legend>
          {#each BSON_TYPES as t (t)}
            <label class="inline"><input type="checkbox" data-type={t} checked={node.bsonType.includes(t)}
              onchange={(e) => toggleType(t, e.currentTarget.checked)} /> {t}</label>
          {/each}
        </fieldset>
        {#if node.bsonType.includes("array") && !node.items}
          <button class="add-items" onclick={() => ed.update(selected, { items: { bsonType: ["string"], required: [], properties: {}, extra: {} } })}>{m.validator_editor_add_items()}</button>
        {/if}
        <div class="grid2">
          <label>{m.validator_editor_minimum()}<input class="f-min" type="number" value={node.minimum ?? numFromExt(node.extra.minimum) ?? ""} onchange={(e) => numPatch("minimum", e.currentTarget.value)} /></label>
          <label>{m.validator_editor_maximum()}<input class="f-max" type="number" value={node.maximum ?? numFromExt(node.extra.maximum) ?? ""} onchange={(e) => numPatch("maximum", e.currentTarget.value)} /></label>
          <label>{m.validator_editor_min_length()}<input class="f-minlen" type="number" value={node.minLength ?? numFromExt(node.extra.minLength) ?? ""} onchange={(e) => numPatch("minLength", e.currentTarget.value)} /></label>
          <label>{m.validator_editor_max_length()}<input class="f-maxlen" type="number" value={node.maxLength ?? numFromExt(node.extra.maxLength) ?? ""} onchange={(e) => numPatch("maxLength", e.currentTarget.value)} /></label>
        </div>
        <label>{m.validator_editor_pattern()}<input class="f-pattern" value={node.pattern ?? ""} onchange={(e) => strPatch("pattern", e.currentTarget.value)} /></label>
        <label>{m.validator_editor_description()}<input class="f-desc" value={node.description ?? ""} onchange={(e) => strPatch("description", e.currentTarget.value)} /></label>
        <label>{m.validator_editor_enum()}<input class="f-enum" class:invalid={enumError} value={enumText} onchange={(e) => enumPatch(e.currentTarget.value)} /></label>
        {#if extraKeys.length}<div class="muted">{m.validator_editor_extra({ keys: extraKeys.join(", ") })}</div>{/if}
        {#if leaf && !isItems}<button class="remove" onclick={remove}>{m.validator_editor_remove()}</button>{/if}
      </div>
    </fieldset>
  {:else}
    <textarea class="validator-json" spellcheck="false" value={ed.jsonText} oninput={(e) => ed.setJsonText(e.currentTarget.value)}></textarea>
  {/if}
  {#if ed.jsonError}<div class="error json-error">{m.validator_editor_json_error({ message: ed.jsonError })}</div>{/if}

  <div class="validator-row">
    <label>{m.collection_info_validation_level()}
      <select bind:value={ed.level}>
        <option value="off">off</option>
        <option value="moderate">moderate</option>
        <option value="strict">strict</option>
      </select>
    </label>
    <label>{m.collection_info_validation_action()}
      <select bind:value={ed.action}>
        <option value="error">error</option>
        <option value="warn">warn</option>
      </select>
    </label>
  </div>
  {#if saveError}<div class="error">{saveError}</div>{/if}
  <div class="validator-actions">
    <button onclick={oncancel} disabled={saving}>{m.common_cancel()}</button>
    <button class="primary save" onclick={() => ed.requestSave()} disabled={saving || !!ed.jsonError || !!ed.loadError}>{m.common_save()}</button>
  </div>
</div>
<DestructiveDialog gate={ed.destructive} />

<style>
  .ve { border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 0.75rem; background: var(--zebra); display: flex; flex-direction: column; gap: 0.5rem; }
  .ve-bar { display: flex; align-items: center; gap: 0.5rem; }
  .ve-tabs { display: flex; margin-right: auto; }
  .ve-tabs button { height: 1.5rem; padding: 0 0.75rem; border: 1px solid var(--gray-b8); background: var(--panel); color: var(--fg); cursor: pointer; font-size: var(--fs); }
  .ve-tabs button.on { background: var(--bg); font-weight: 600; }
  button { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: var(--radius); background: var(--panel); color: var(--fg); cursor: pointer; font-size: var(--fs); }
  button:hover:not(:disabled) { background: var(--bg); }
  button:disabled { color: var(--gray-b8); cursor: default; }
  .ve-result { padding: 0.375rem 0.625rem; background: var(--panel); border-radius: var(--radius); display: flex; gap: 0.75rem; align-items: center; }
  .ve-result.bad { color: var(--error); }
  .ve-body { border: none; padding: 0; margin: 0; min-width: 0; display: grid; grid-template-columns: minmax(10rem, 1fr) 2fr; gap: 0.75rem; min-height: 12rem; }
  .tree { list-style: none; margin: 0; padding: 0; overflow: auto; max-height: 20rem; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); }
  .row { display: flex; width: 100%; height: auto; padding: 0.1875rem 0.5rem; gap: 0.5rem; border: none; border-radius: 0; text-align: left; background: transparent; }
  .row.sel { background: var(--bg); font-weight: 600; }
  .ty { color: var(--muted); font-family: var(--mono); }
  .req { color: var(--error); }
  .pad { padding: 0.5rem; }
  .props { display: flex; flex-direction: column; gap: 0.375rem; font-size: var(--fs); color: var(--gray-55); }
  .props label { display: flex; flex-direction: column; gap: 0.125rem; }
  .props label.inline { flex-direction: row; align-items: center; gap: 0.25rem; display: inline-flex; }
  .props label.add { flex-direction: row; gap: 0.375rem; }
  .props input:not([type="checkbox"]) { height: 1.5rem; box-sizing: border-box; padding: 0 0.375rem; }
  .props input.invalid { outline: 1px solid var(--error); }
  .types { border: 1px solid var(--border); border-radius: var(--radius); display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.375rem; }
  .muted { color: var(--muted); }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; }
  .validator-json { width: 100%; box-sizing: border-box; height: 14rem; padding: 0.375rem; font-family: var(--mono); font-size: var(--fs); resize: vertical; }
  .validator-row { display: flex; gap: 1.25rem; font-size: var(--fs); color: var(--gray-55); }
  .validator-row select { display: block; margin-top: 0.25rem; }
  .validator-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
  .validator-actions button { height: 1.75rem; padding: 0 0.875rem; }
  .validator-actions .primary { background: var(--run); color: var(--on-accent); border: none; font-weight: 600; }
  .validator-actions .primary:hover:not(:disabled) { background: var(--run-hover); }
</style>
