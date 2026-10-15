<!-- StageCard — one pipeline stage: a one-line summary with its document count; selecting it opens its form (or the JSON body) and previews the pipeline through it. -->
<script lang="ts">
  import type { PipelineTree } from "../../stores/pipelineTree.svelte";
  import { STAGE_CODECS } from "../../domain/stageForms";
  import type { FieldInfo } from "../../domain/fieldInfo";
  import type { Chip } from "../../domain/filterChips";
  import { PIPELINE_STAGES } from "../../domain/mongoOps";
  import { msgCount, msgKey } from "#lib/msgkey.js";
  import FilterChips from "../FilterChips.svelte";
  import CodeEditor from "../CodeEditor.svelte";
  import GroupForm from "./GroupForm.svelte";
  import SortForm from "./SortForm.svelte";
  import ProjectForm from "./ProjectForm.svelte";
  import SimpleForms from "./SimpleForms.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { tree, index, collections = [] }: { tree: PipelineTree; index: number; collections?: string[] } = $props();

  const stage = $derived(tree.stages[index]);
  const codec = $derived(STAGE_CODECS[stage.name]);
  const parsed = $derived(codec ? codec.parse(stage.body) : null);
  // While a form is mid-edit (e.g. a group-by field still empty) its model may not build a valid
  // body yet: keep that draft on screen and only push bodies that read back as the same form.
  let draft = $state.raw<{ forBody: unknown; model: unknown } | null>(null);
  const model = $derived(draft && draft.forBody === stage.body ? draft.model : parsed);
  const selected = $derived(tree.selectedId === stage.id);
  const enabled = $derived(stage.enabled !== false);
  const count = $derived(tree.counts[stage.id]);
  const warnings = $derived(tree.warnings.filter((w) => w.index === index));
  const summary = $derived.by(() => {
    if (codec && model !== null) return codec.summarize(model);
    const text = JSON.stringify(stage.body);
    return text.length > 80 ? `${text.slice(0, 79)}…` : text;
  });

  let jsonMode = $state(false);
  let jsonText = $state("");
  let jsonError = $state(false);
  let fields = $state<FieldInfo[]>([]);
  const showJson = $derived(jsonMode || model === null);

  function edit(next: unknown) {
    if (!codec) return;
    const body = codec.build(next);
    if (codec.parse(body) !== null) {
      update(body);
      draft = { forBody: body, model: next };
    } else {
      draft = { forBody: stage.body, model: next };
    }
  }

  $effect(() => {
    if (!selected) return;
    const i = index;
    void tree.fieldsAt(i).then((f) => (fields = f));
  });
  $effect(() => {
    if (showJson && !jsonError) jsonText = JSON.stringify(stage.body, null, 2);
  });

  const update = (body: unknown) => tree.updateStageBody(index, body);
  function onJson(text: string) {
    jsonText = text;
    try {
      update(JSON.parse(text));
      jsonError = false;
    } catch {
      jsonError = true;
    }
  }
</script>

<div class="card" class:selected class:disabled={!enabled}>
  <div class="head">
    <button class="summary" aria-expanded={selected} onclick={() => tree.select(selected ? null : stage.id)}>
      <span class="name">{stage.name}</span>
      <span class="sum">{summary}</span>
      {#if !codec || model === null}<span class="adv">{m.builder_advanced()}</span>{/if}
    </button>
    <span class="count" class:err={count === "error"} class:zero={count === 0} title={count === "error" ? m.builder_count_error() : undefined}>
      {count === null || count === undefined ? (enabled ? m.builder_counting() : "") : count === "error" ? "—" : msgCount("builder_docs", count)}
    </span>
    <span class="acts">
      <button class="ic" aria-label={m.builder_move_up()} title={m.builder_move_up()} disabled={index === 0} onclick={() => tree.reorderStage(index, index - 1)}>↑</button>
      <button class="ic" aria-label={m.builder_move_down()} title={m.builder_move_down()} disabled={index === tree.stages.length - 1} onclick={() => tree.reorderStage(index, index + 1)}>↓</button>
      <button class="ic" aria-label={enabled ? m.builder_disable() : m.builder_enable()} title={enabled ? m.builder_disable() : m.builder_enable()} aria-pressed={!enabled} onclick={() => tree.setEnabled(index, !enabled)}>{enabled ? "◉" : "○"}</button>
      <button class="ic" aria-label={m.builder_duplicate()} title={m.builder_duplicate()} onclick={() => tree.duplicateStage(index)}>⧉</button>
      <button class="ic danger" aria-label={m.builder_delete()} title={m.builder_delete()} onclick={() => tree.removeStage(index)}>×</button>
    </span>
  </div>

  {#each warnings as w (w.key)}<div class="warn">⚠ {msgKey(`builder_warn_${w.key}`)}</div>{/each}

  {#if selected}
    <div class="body">
      <div class="body-top">
        <select class="b-input" aria-label={m.pipeline_tree_stage_picker_label()} value={stage.name} onchange={(e) => tree.renameStage(index, e.currentTarget.value)}>
          {#each PIPELINE_STAGES as s (s.label)}<option value={s.label} title={s.detail}>{s.label}</option>{/each}
        </select>
        {#if codec && model !== null}
          <button class="b-link" onclick={() => { jsonError = false; jsonMode = !jsonMode; }}>{jsonMode ? m.builder_edit_form() : m.builder_edit_json()}</button>
        {/if}
      </div>
      {#if showJson}
        <div class="json"><CodeEditor value={jsonText} onChange={onJson} /></div>
        {#if jsonError}<div class="b-error">{m.builder_invalid_json()}</div>{/if}
      {:else if stage.name === "$match"}
        <div class="match">
          <FilterChips chips={model as Chip[]} {fields} valuesFor={() => []} slowHint={() => false}
            zero={count === 0} history={[]} onchange={edit} onhistory={() => {}} onpin={() => {}} onclearhistory={() => {}} />
        </div>
      {:else if stage.name === "$group"}
        <GroupForm value={model as never} {fields} onchange={edit} />
      {:else if stage.name === "$sort"}
        <SortForm value={model as never} {fields} onchange={edit} />
      {:else if stage.name === "$project" || stage.name === "$addFields" || stage.name === "$set"}
        <ProjectForm value={model as never} {fields} allowKeepDrop={stage.name === "$project"} onchange={edit} />
      {:else}
        <SimpleForms kind={stage.name as never} value={model} {fields} {collections} onchange={edit} />
      {/if}
    </div>
  {/if}
</div>

<style>
  .card { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--panel); margin-bottom: 0.375rem; }
  .card.selected { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent); }
  .card.disabled { opacity: 0.55; }
  .head { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0.375rem 0.25rem 0.25rem; }
  .summary { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 0.5rem; padding: 0.25rem 0.375rem; border: none; border-radius: var(--radius); background: none; color: var(--fg); cursor: pointer; text-align: left; }
  .summary:hover { background: var(--hover); }
  .name { font-family: var(--mono); font-weight: 600; color: var(--accent); flex: none; }
  .sum { font-size: 0.75rem; color: var(--c-subtext1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .adv { flex: none; font-size: 0.625rem; padding: 0 0.3125rem; border-radius: var(--radius-sm); background: var(--menu-hover); color: var(--muted); }
  .count { flex: none; font-size: 0.75rem; font-variant-numeric: tabular-nums; color: var(--muted); }
  .count.zero { color: var(--warn-fg); }
  .count.err { color: var(--error); }
  .acts { display: flex; gap: 0.125rem; flex: none; }
  .ic { width: 1.5rem; height: 1.5rem; border: none; border-radius: var(--radius-sm); background: none; color: var(--muted); cursor: pointer; font-size: 0.8125rem; }
  .ic:hover:not(:disabled) { background: var(--menu-hover); color: var(--fg); }
  .ic:disabled { opacity: 0.35; cursor: default; }
  .ic.danger:hover { color: var(--error); }
  .warn { margin: 0 0.625rem 0.375rem; font-size: 0.6875rem; color: var(--warn-fg); }
  .body { padding: 0.5rem 0.75rem 0.75rem; border-top: 1px solid var(--border); }
  .body-top { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
  .json { border: 1px solid var(--c-surface1); border-radius: var(--radius); min-height: 6rem; max-height: 18rem; overflow: auto; }
  .match { display: flex; }
</style>
