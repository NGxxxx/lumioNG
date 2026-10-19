<!-- TemplatePicker — ready-made pipelines that ask one or two questions, then insert their stages. -->
<script lang="ts">
  import type { TemplateId } from "../../stores/pipelineTree.svelte";
  import type { FieldInfo } from "../../domain/fieldInfo";
  import FieldPicker from "./FieldPicker.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { fields, collections = [], onapply, onclose }: {
    fields: FieldInfo[];
    collections?: string[];
    onapply: (id: TemplateId, args: Record<string, string | number>) => void;
    onclose: () => void;
  } = $props();

  type Q = { key: string; label: () => string; kind: "field" | "number" | "text" };
  const TEMPLATES: { id: TemplateId; label: () => string; qs: Q[] }[] = [
    { id: "countBy", label: m.builder_tpl_countBy, qs: [{ key: "field", label: m.builder_tpl_field, kind: "field" }] },
    { id: "topN", label: m.builder_tpl_topN, qs: [{ key: "field", label: m.builder_tpl_field, kind: "field" }, { key: "n", label: m.builder_tpl_n, kind: "number" }] },
    { id: "sumPerMonth", label: m.builder_tpl_sumPerMonth, qs: [{ key: "dateField", label: m.builder_tpl_date, kind: "field" }, { key: "valueField", label: m.builder_tpl_value, kind: "field" }] },
    { id: "join", label: m.builder_tpl_join, qs: [
      { key: "from", label: m.builder_lookup_from, kind: "text" }, { key: "localField", label: m.builder_lookup_local, kind: "field" },
      { key: "foreignField", label: m.builder_lookup_foreign, kind: "text" }, { key: "as", label: m.builder_lookup_as, kind: "text" },
    ] },
    { id: "duplicates", label: m.builder_tpl_duplicates, qs: [{ key: "field", label: m.builder_tpl_field, kind: "field" }] },
    { id: "distinct", label: m.builder_tpl_distinct, qs: [{ key: "field", label: m.builder_tpl_field, kind: "field" }] },
    { id: "latest", label: m.builder_tpl_latest, qs: [{ key: "dateField", label: m.builder_tpl_date, kind: "field" }, { key: "n", label: m.builder_tpl_n, kind: "number" }] },
    { id: "countPerDay", label: m.builder_tpl_countPerDay, qs: [{ key: "dateField", label: m.builder_tpl_date, kind: "field" }] },
  ];

  let picked = $state<(typeof TEMPLATES)[number] | null>(null);
  let args = $state<Record<string, string>>({});
  const ready = $derived(!!picked && picked.qs.every((q) => (args[q.key] ?? "").trim() !== ""));

  function apply() {
    if (!picked || !ready) return;
    const out: Record<string, string | number> = {};
    for (const q of picked.qs) out[q.key] = q.kind === "number" ? Number(args[q.key]) : args[q.key].trim();
    onapply(picked.id, out);
    onclose();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="tpl" role="dialog" tabindex="-1" aria-label={m.builder_templates()} onkeydown={(e) => { if (e.key === "Escape") onclose(); if (e.key === "Enter") apply(); }}>
  {#if !picked}
    {#each TEMPLATES as t (t.id)}
      <button class="item" onclick={() => { picked = t; args = t.id === "topN" || t.id === "latest" ? { n: "10" } : {}; }}>{t.label()}</button>
    {/each}
  {:else}
    <div class="title">{picked.label()}</div>
    {#each picked.qs as q (q.key)}
      <label class="q"><span>{q.label()}</span>
        {#if q.kind === "field"}
          <FieldPicker {fields} value={args[q.key] ?? ""} label={q.label()} onchange={(v) => (args = { ...args, [q.key]: v })} />
        {:else}
          <input class="b-input" type={q.kind === "number" ? "number" : "text"} list={q.key === "from" ? "tpl-colls" : undefined} value={args[q.key] ?? ""} aria-label={q.label()} oninput={(e) => (args = { ...args, [q.key]: e.currentTarget.value })} />
        {/if}
      </label>
    {/each}
    <datalist id="tpl-colls">{#each collections as c (c)}<option value={c}></option>{/each}</datalist>
    <div class="row">
      <button class="b-link" onclick={() => (picked = null)}>←</button>
      <button class="primary" disabled={!ready} onclick={apply}>{m.builder_tpl_insert()}</button>
    </div>
  {/if}
</div>

<style>
  .tpl { position: absolute; top: calc(100% + 0.25rem); right: 0; z-index: 30; width: 18rem; padding: 0.375rem; border: 1px solid var(--c-surface1); border-radius: var(--radius-lg); background: var(--popover); box-shadow: var(--shadow-sm); display: flex; flex-direction: column; gap: 0.25rem; }
  .item { text-align: left; padding: 0.375rem 0.5rem; border: none; border-radius: var(--radius-sm); background: none; color: var(--fg); cursor: pointer; font-size: var(--fs); }
  .item:hover { background: var(--menu-hover); }
  .title { font-weight: 600; font-size: var(--fs); padding: 0.125rem 0.25rem 0.25rem; }
  .q { display: flex; flex-direction: column; gap: 0.1875rem; font-size: 0.6875rem; color: var(--muted); padding: 0 0.25rem; }
  .row { display: flex; justify-content: space-between; align-items: center; padding: 0.25rem; }
  .primary { height: 1.75rem; padding: 0 0.75rem; border: none; border-radius: var(--radius); background: var(--accent); color: #fff; cursor: pointer; }
  .primary:disabled { opacity: 0.5; cursor: default; }
</style>
