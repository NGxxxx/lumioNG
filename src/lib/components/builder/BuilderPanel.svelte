<!-- BuilderPanel — the query tab's pipeline builder: header (collection, add stage, templates), stage cards, next-step chips. State lives in stores/pipelineTree. -->
<script lang="ts">
  import type { PipelineTree } from "../../stores/pipelineTree.svelte";
  import type { FieldInfo } from "../../domain/fieldInfo";
  import { PIPELINE_STAGES } from "../../domain/mongoOps";
  import { defaultStageBody } from "../../domain/pipelineStages";
  import { msgKey } from "#lib/msgkey.js";
  import { clickOutside } from "../../actions/clickOutside";
  import StageCard from "./StageCard.svelte";
  import TemplatePicker from "./TemplatePicker.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { tree, collections = [], onexplain }: { tree: PipelineTree; collections?: string[]; onexplain?: () => void } = $props();

  let addPicker = $state("$match");
  let templatesOpen = $state(false);
  let sourceFields = $state<FieldInfo[]>([]);

  $effect(() => {
    if (!templatesOpen) return;
    void tree.fieldsAt(tree.stages.length).then((f) => (sourceFields = f));
  });

  function add(name: string) {
    tree.addStep({ name, body: defaultStageBody(name) });
    const last = tree.stages[tree.stages.length - 1];
    if (last) tree.select(last.id);
  }
</script>

<div class="builder">
  {#if tree.parseError}
    <div class="parse-error">{msgKey(tree.parseError)}</div>
  {:else}
    <div class="bar">
      <span class="coll"><span class="b-muted">{m.builder_collection()}</span> <b class="mono">{tree.coll}</b></span>
      <span class="spacer"></span>
      <select class="b-input" bind:value={addPicker} aria-label={m.pipeline_tree_stage_picker_label()}>
        {#each PIPELINE_STAGES as s (s.label)}<option value={s.label} title={s.detail}>{s.label}</option>{/each}
      </select>
      <button class="btn" onclick={() => add(addPicker)}>{m.builder_add_stage()}</button>
      <span class="tplwrap" use:clickOutside={() => (templatesOpen = false)}>
        <button class="btn" aria-expanded={templatesOpen} onclick={() => (templatesOpen = !templatesOpen)}>{m.builder_templates()} ▾</button>
        {#if templatesOpen}
          <TemplatePicker fields={sourceFields} {collections} onapply={(id, a) => tree.applyTemplate(id, a)} onclose={() => (templatesOpen = false)} />
        {/if}
      </span>
      {#if onexplain}<button class="btn" onclick={onexplain}>{m.builder_explain()}</button>{/if}
    </div>

    {#if tree.discardedNotice > 0}
      <div class="notice">
        {m.builder_discarded({ count: String(tree.discardedNotice) })}
        <button class="b-link" onclick={() => tree.dismissDiscardedNotice()}>{m.builder_dismiss()}</button>
      </div>
    {/if}

    <div class="list">
      {#if tree.stages.length === 0}<div class="empty">{m.builder_empty()}</div>{/if}
      {#each tree.stages as stage, i (stage.id)}
        <StageCard {tree} index={i} {collections} />
      {/each}
      {#if tree.nextSteps.length}
        <div class="next">
          <span class="b-muted">{m.builder_next()}</span>
          {#each tree.nextSteps as s (s.label)}
            <button class="chip" onclick={() => { tree.addStep(s.stage); const last = tree.stages[tree.stages.length - 1]; if (last) tree.select(last.id); }}>{s.label}</button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .builder { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0.5rem 0.625rem; box-sizing: border-box; gap: 0.375rem; }
  .parse-error { color: var(--warn-fg); background: var(--warn-bg2); padding: 0.5rem 0.75rem; border-radius: var(--radius); font-size: var(--fs); }
  .bar { display: flex; align-items: center; gap: 0.375rem; flex: none; }
  .coll { font-size: var(--fs); }
  .spacer { flex: 1; }
  .tplwrap { position: relative; }
  .btn { height: 1.75rem; padding: 0 0.625rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--panel); color: var(--fg); font-size: 0.75rem; cursor: pointer; }
  .btn:hover { background: var(--menu-hover); }
  .notice { display: flex; align-items: center; gap: 0.75rem; padding: 0.375rem 0.625rem; border-radius: var(--radius); background: var(--warn-bg); color: var(--warn-fg); font-size: 0.75rem; }
  .list { flex: 1; min-height: 0; overflow: auto; }
  .empty { padding: 1rem; color: var(--muted); font-size: var(--fs); text-align: center; }
  .next { display: flex; align-items: center; flex-wrap: wrap; gap: 0.375rem; padding: 0.25rem 0.125rem; font-size: 0.75rem; }
  .chip { height: 1.5rem; padding: 0 0.625rem; border: 1px dashed var(--c-surface1); border-radius: 999px; background: none; color: var(--fg); cursor: pointer; font-size: 0.75rem; }
  .chip:hover { border-style: solid; border-color: var(--accent); }

  /* Shared form vocabulary for every stage form. */
  .builder :global(.b-form) { display: flex; flex-direction: column; gap: 0.375rem; }
  .builder :global(.b-row) { display: flex; align-items: center; flex-wrap: wrap; gap: 0.375rem; }
  .builder :global(.b-row.indent), .builder :global(.b-link.indent) { margin-left: 1rem; }
  .builder :global(.b-grid) { display: grid; grid-template-columns: 11rem minmax(0, 1fr); gap: 0.375rem 0.75rem; align-items: center; max-width: 36rem; }
  .builder :global(.b-label) { font-size: 0.75rem; color: var(--muted); }
  .builder :global(.b-muted) { font-size: 0.75rem; color: var(--muted); }
  .builder :global(.b-input) { height: 1.75rem; padding: 0 0.5rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--bg); color: var(--fg); font-size: var(--fs); min-width: 8rem; }
  .builder :global(.b-input:focus) { outline: none; border-color: var(--accent); }
  .builder :global(.b-input.mono), .builder :global(.mono) { font-family: var(--mono); }
  .builder :global(.b-input.short) { min-width: 0; width: 7rem; }
  .builder :global(.b-input.grow) { flex: 1; min-width: 12rem; }
  .builder :global(.b-check) { display: flex; align-items: center; gap: 0.375rem; font-size: 0.75rem; }
  .builder :global(.b-link) { align-self: flex-start; border: none; background: none; padding: 0; color: var(--link); font-size: 0.75rem; cursor: pointer; }
  .builder :global(.b-x) { width: 1.5rem; height: 1.5rem; border: none; border-radius: var(--radius-sm); background: none; color: var(--muted); cursor: pointer; }
  .builder :global(.b-x:hover) { color: var(--error); background: var(--menu-hover); }
  .builder :global(.b-error) { color: var(--error); font-size: 0.75rem; margin-top: 0.25rem; }
</style>
