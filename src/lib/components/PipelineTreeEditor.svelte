<!-- src/lib/components/PipelineTreeEditor.svelte -->
<script lang="ts">
  import type { PipelineTree } from "../stores/pipelineTree.svelte";
  import { PIPELINE_STAGES } from "../domain/mongoOps";
  import PipelineStageCard from "./PipelineStageCard.svelte";
  import * as m from "#lib/paraglide/messages.js";
  import { msgKey } from "#lib/msgkey.js";

  let { tree, db }: { tree: PipelineTree; db: string } = $props();

  let addPicker = $state(PIPELINE_STAGES[0].label);

  function addStage() {
    tree.addStage(addPicker, tree.stages.length);
  }
</script>

<div class="pipeline-tree">
  {#if tree.parseError}
    <div class="parse-error">{msgKey(tree.parseError)}</div>
  {:else}
    <div class="toolbar">
      <label class="auto-preview">
        <input
          type="checkbox"
          checked={tree.autoPreview}
          onchange={(e) => tree.setAutoPreview((e.currentTarget as HTMLInputElement).checked)}
        />
        {m.pipeline_tree_auto_preview()}
      </label>
      <div class="spacer"></div>
      <select class="add-stage-picker" bind:value={addPicker} aria-label={m.pipeline_tree_stage_picker_label()}>
        {#each PIPELINE_STAGES as s (s.label)}<option value={s.label} title={s.detail}>{s.label}</option>{/each}
      </select>
      <button onclick={addStage}>{m.pipeline_tree_add_stage()}</button>
    </div>
    <div class="stage-list">
      {#each tree.stages as stage, i (stage.id)}
        <PipelineStageCard {tree} index={i} {db} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .pipeline-tree { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0.5rem; box-sizing: border-box; }
  .parse-error { color: var(--warn-fg); background: var(--warn-bg2); padding: 0.5rem 0.75rem; border-radius: var(--radius); font-size: var(--fs); }
  .toolbar { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; flex: none; }
  .auto-preview { display: flex; align-items: center; gap: 0.25rem; font-size: var(--fs); color: var(--gray-77); }
  .spacer { flex: 1; }
  .stage-list { flex: 1; min-height: 0; overflow: auto; }
</style>
