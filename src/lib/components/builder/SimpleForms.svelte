<!-- SimpleForms — $limit / $skip / $sample (number), $count (name), $unwind, $lookup, $sortByCount / $replaceRoot (one field), $unset (field list). -->
<script lang="ts">
  import type { UnwindModel, LookupModel } from "../../domain/stageForms";
  import type { FieldInfo } from "../../domain/fieldInfo";
  import FieldPicker from "./FieldPicker.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { kind, value, fields, collections = [], onchange }: {
    kind: "$limit" | "$skip" | "$sample" | "$count" | "$unwind" | "$lookup" | "$sortByCount" | "$replaceRoot" | "$unset";
    value: unknown;
    fields: FieldInfo[];
    collections?: string[];
    onchange: (v: unknown) => void;
  } = $props();
  const listId = `colls-${Math.random().toString(36).slice(2, 9)}`;
</script>

<div class="b-form">
  {#if kind === "$limit" || kind === "$skip"}
    <div class="b-row">
      <input class="b-input short" type="number" min="0" step="1" value={value as number} aria-label={m.builder_number()}
        oninput={(e) => { const n = Number(e.currentTarget.value); if (Number.isInteger(n) && n >= 0) onchange(n); }} />
    </div>
  {:else if kind === "$sample"}
    <div class="b-row">
      <span class="b-label">{m.builder_sample_size()}</span>
      <input class="b-input short" type="number" min="1" step="1" value={value as number} aria-label={m.builder_sample_size()}
        oninput={(e) => { const n = Number(e.currentTarget.value); if (Number.isInteger(n) && n >= 1) onchange(n); }} />
    </div>
  {:else if kind === "$sortByCount" || kind === "$replaceRoot"}
    {@const label = kind === "$sortByCount" ? m.builder_sortbycount_field() : m.builder_replaceroot_field()}
    <div class="b-row">
      <span class="b-label">{label}</span>
      <FieldPicker {fields} value={value as string} {label} onchange={(p) => { if (p) onchange(p); }} />
    </div>
  {:else if kind === "$unset"}
    {@const list = value as string[]}
    <span class="b-label">{m.builder_unset_fields()}</span>
    {#each list as f, i (i)}
      <div class="b-row">
        <FieldPicker {fields} value={f} label={`${m.builder_unset_fields()} ${i + 1}`} onchange={(p) => { if (p) onchange(list.map((x, j) => (j === i ? p : x))); }} />
        {#if list.length > 1}<button class="b-x" aria-label={m.builder_remove()} onclick={() => onchange(list.filter((_, j) => j !== i))}>×</button>{/if}
      </div>
    {/each}
    <button class="b-link" onclick={() => onchange([...list, ""])}>{m.builder_project_add()}</button>
  {:else if kind === "$count"}
    <div class="b-row">
      <span class="b-label">{m.builder_count_as()}</span>
      <input class="b-input mono short" value={value as string} aria-label={m.builder_count_as()} oninput={(e) => { const s = e.currentTarget.value.trim(); if (s) onchange(s); }} />
    </div>
  {:else if kind === "$unwind"}
    {@const u = value as UnwindModel}
    <div class="b-row">
      <span class="b-label">{m.builder_unwind_path()}</span>
      <FieldPicker fields={fields.filter((f) => f.type === "array" || f.type === "unknown")} value={u.path} label={m.builder_unwind_path()} onchange={(p) => onchange({ ...u, path: p })} />
    </div>
    <label class="b-check"><input type="checkbox" checked={u.preserve} onchange={(e) => onchange({ ...u, preserve: e.currentTarget.checked })} /> {m.builder_unwind_keep()}</label>
  {:else if kind === "$lookup"}
    {@const l = value as LookupModel}
    <div class="b-grid">
      <span class="b-label">{m.builder_lookup_from()}</span>
      <input class="b-input mono" list={listId} value={l.from} aria-label={m.builder_lookup_from()} oninput={(e) => onchange({ ...l, from: e.currentTarget.value.trim() })} />
      <span class="b-label">{m.builder_lookup_local()}</span>
      <FieldPicker {fields} value={l.localField} label={m.builder_lookup_local()} onchange={(p) => onchange({ ...l, localField: p })} />
      <span class="b-label">{m.builder_lookup_foreign()}</span>
      <input class="b-input mono" value={l.foreignField} aria-label={m.builder_lookup_foreign()} oninput={(e) => onchange({ ...l, foreignField: e.currentTarget.value.trim() })} />
      <span class="b-label">{m.builder_lookup_as()}</span>
      <input class="b-input mono" value={l.as} aria-label={m.builder_lookup_as()} oninput={(e) => onchange({ ...l, as: e.currentTarget.value.trim() })} />
    </div>
    <datalist id={listId}>{#each collections as c (c)}<option value={c}></option>{/each}</datalist>
  {/if}
</div>
