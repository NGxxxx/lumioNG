<!-- src/lib/components/PipelineStageCard.svelte -->
<script lang="ts">
  import type { PipelineTree } from "../stores/pipelineTree.svelte";
  import { PIPELINE_STAGES } from "../domain/mongoOps";
  import { stageBodyKind } from "../domain/pipelineStages";
  import { describeValue } from "../domain/extjson";
  import { hasInput, type LeafInputType } from "../domain/bsontree";
  import TreeEditor from "./TreeEditor.svelte";
  import TreeLeafInput from "./TreeLeafInput.svelte";
  import ResultTree from "./ResultTree.svelte";
  import type { Doc } from "../domain/doc";
  import * as m from "$lib/paraglide/messages";

  let { tree, index, db }: { tree: PipelineTree; index: number; db: string } = $props();

  const stage = $derived(tree.stages[index]);
  const kind = $derived(stageBodyKind(stage.body));
  const leafType = $derived(kind === "leaf" ? (describeValue(stage.body).type as LeafInputType) : null);
  const preview = $derived(tree.previewFor(stage.id));

  // Runs once at card creation (so an already-parsed stage shows a preview immediately, without
  // requiring an edit first) AND again whenever `db` changes for this same already-rendered card —
  // otherwise a card mounted under one db would keep showing a preview fetched against a since-
  // abandoned database. Re-running when `stage` itself changes (e.g. after onBodyChange) is
  // harmless/redundant: requestPreview is debounced per stage id.
  $effect(() => {
    tree.requestPreview(stage.id, db);
  });

  function onBodyChange(v: unknown) {
    tree.updateStageBody(index, v);
    tree.requestPreview(stage.id, db);
  }

  function onDragStart(e: DragEvent) {
    e.dataTransfer?.setData("text/plain", String(index));
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    const from = Number(e.dataTransfer?.getData("text/plain"));
    if (!Number.isNaN(from) && from !== index) tree.reorderStage(from, index);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="stage-card"
  draggable="true"
  ondragstart={onDragStart}
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
>
  <div class="stage-head">
    <span class="drag-handle" aria-hidden="true">⠿</span>
    <select
      class="stage-name"
      value={stage.name}
      aria-label={m.pipeline_tree_stage_picker_label()}
      onchange={(e) => tree.renameStage(index, (e.currentTarget as HTMLSelectElement).value)}
    >
      {#each PIPELINE_STAGES as s (s.label)}<option value={s.label}>{s.label}</option>{/each}
    </select>
    <div class="spacer"></div>
    <button onclick={() => tree.reorderStage(index, index - 1)} disabled={index === 0} aria-label={m.pipeline_tree_move_up()}>▲</button>
    <button onclick={() => tree.reorderStage(index, index + 1)} disabled={index === tree.stages.length - 1} aria-label={m.pipeline_tree_move_down()}>▼</button>
    <button onclick={() => tree.removeStage(index)} aria-label={m.pipeline_tree_remove_stage()}>✕</button>
  </div>

  <div class="stage-body">
    {#if kind === "object"}
      <TreeEditor value={stage.body as Doc} onchange={onBodyChange} onvalidchange={() => {}} lockedKeys={[]} compact />
    {:else if kind === "leaf" && leafType && hasInput(leafType)}
      <TreeLeafInput type={leafType} value={stage.body} onchange={onBodyChange} onerror={() => {}} />
    {:else}
      <pre class="unsupported">{m.pipeline_tree_unsupported_body()}</pre>
    {/if}
  </div>

  <div class="stage-preview">
    <div class="preview-toolbar">
      <button onclick={() => tree.runPreview(stage.id, db)} disabled={preview.loading}>{m.pipeline_tree_preview_button()}</button>
    </div>
    {#if preview.loading}
      <div class="status">{m.pipeline_tree_preview_loading()}</div>
    {:else if preview.error === "pipeline_tree_preview_write_stage_blocked"}
      <div class="status">{m.pipeline_tree_preview_write_stage_blocked()}</div>
    {:else if preview.error}
      <div class="status error">{m.pipeline_tree_preview_error({ error: preview.error })}</div>
    {:else if !preview.hasRun || preview.docs.length === 0}
      <div class="status">{preview.hasRun ? m.pipeline_tree_preview_empty() : ""}</div>
    {:else}
      <ResultTree docs={preview.docs} />
    {/if}
  </div>
</div>

<style>
  .stage-card { border: 1px solid var(--gray-c4); border-radius: 0.1875rem; margin-bottom: 0.5rem; background: var(--panel); }
  .stage-head { display: flex; align-items: center; gap: 0.375rem; padding: 0.25rem 0.5rem; border-bottom: 1px solid var(--border); }
  .drag-handle { cursor: grab; color: var(--gray-77); }
  .spacer { flex: 1; }
  .stage-body { max-height: 12rem; overflow: auto; }
  .unsupported { margin: 0; padding: 0.5rem; color: var(--muted); font-size: var(--fs); }
  .stage-preview { border-top: 1px solid var(--border); max-height: 10rem; overflow: auto; }
  .preview-toolbar { display: flex; justify-content: flex-end; padding: 0.25rem 0.5rem; border-bottom: 1px solid var(--border); }
  .status { padding: 0.375rem 0.5rem; color: var(--muted); font-size: var(--fs); display: flex; align-items: center; gap: 0.5rem; }
  .status.error { color: var(--error); }
</style>
