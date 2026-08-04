<!-- src/lib/components/PipelineStageCard.svelte -->
<script lang="ts">
  import type { PipelineTree } from "../stores/pipelineTree.svelte";
  import { fieldsFor } from "../stores/fieldSuggestions";
  import { createAsyncGuard } from "../stores/asyncGuard.svelte";
  import { PIPELINE_STAGES } from "../domain/mongoOps";
  import { stageBodyKind, isDefaultStageBody } from "../domain/pipelineStages";
  import { operatorSuggestionsFor } from "../domain/pipelineComplete";
  import { describeValue } from "../domain/extjson";
  import { hasInput, type LeafInputType } from "../domain/bsontree";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import TreeEditor from "./TreeEditor.svelte";
  import TreeLeafInput from "./TreeLeafInput.svelte";
  import ResultTree from "./ResultTree.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import type { MenuItem } from "../domain/gridView";
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

  // Guards against a stale response overwriting a fresher one (e.g. db switched A→B→A quickly) —
  // same generation-token pattern pipelineTree.svelte.ts uses for its own preview fetches.
  let fieldSuggestions = $state<string[]>([]);
  const fieldSuggestionsGuard = createAsyncGuard();
  $effect(() => {
    const gen = fieldSuggestionsGuard.begin();
    fieldsFor(tree.sessionId, db, tree.coll)
      .then((f) => {
        if (fieldSuggestionsGuard.isCurrent(gen)) fieldSuggestions = f;
      })
      .finally(() => fieldSuggestionsGuard.finish(gen));
  });

  let pendingRename = $state<string | null>(null);
  let selectEl = $state<HTMLSelectElement | null>(null);
  let menu = $state<{ x: number; y: number } | null>(null);

  const menuItems = $derived.by((): MenuItem[] => {
    const items: MenuItem[] = [
      { label: m.pipeline_tree_menu_cut(), action: "cut" },
      { label: m.pipeline_tree_menu_copy(), action: "copy" },
    ];
    if (tree.hasClipboard) items.push({ label: m.pipeline_tree_menu_paste(), action: "paste" });
    items.push({ label: m.pipeline_tree_menu_duplicate(), action: "duplicate" });
    items.push({ label: m.pipeline_tree_menu_delete(), action: "delete" });
    return items;
  });

  function onMenuSelect(action: string) {
    menu = null;
    if (action === "cut") tree.cutStage(index);
    else if (action === "copy") tree.copyStage(index);
    else if (action === "paste") tree.pasteStageAfter(index);
    else if (action === "duplicate") tree.duplicateStage(index);
    else if (action === "delete") tree.removeStage(index);
  }

  function onBodyChange(v: unknown) {
    tree.updateStageBody(index, v);
    tree.requestPreview(stage.id, db);
  }

  function onOperatorChange(name: string) {
    if (isDefaultStageBody(stage.name, stage.body)) {
      tree.renameStage(index, name);
    } else {
      pendingRename = name;
    }
  }

  function cancelRename() {
    if (selectEl) selectEl.value = stage.name;
    pendingRename = null;
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
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
>
  <div
    class="stage-head"
    oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); menu = { x: e.clientX, y: e.clientY }; }}
  >
    <span class="drag-handle" aria-hidden="true" draggable="true" ondragstart={onDragStart}>⠿</span>
    <select
      bind:this={selectEl}
      class="stage-name"
      value={stage.name}
      aria-label={m.pipeline_tree_stage_picker_label()}
      onchange={(e) => onOperatorChange((e.currentTarget as HTMLSelectElement).value)}
    >
      {#each PIPELINE_STAGES as s (s.label)}<option value={s.label} title={s.detail}>{s.label}</option>{/each}
    </select>
    <div class="spacer"></div>
    <button onclick={() => tree.reorderStage(index, index - 1)} disabled={index === 0} aria-label={m.pipeline_tree_move_up()}>▲</button>
    <button onclick={() => tree.reorderStage(index, index + 1)} disabled={index === tree.stages.length - 1} aria-label={m.pipeline_tree_move_down()}>▼</button>
    <button onclick={() => tree.removeStage(index)} aria-label={m.pipeline_tree_remove_stage()}>✕</button>
  </div>

  <div class="stage-body">
    {#if kind === "object"}
      <TreeEditor value={stage.body as Doc} onchange={onBodyChange} onvalidchange={() => {}} lockedKeys={[]} compact {fieldSuggestions} operatorSuggestionsFor={(depth) => operatorSuggestionsFor(stage.name, depth)} />
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

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menuItems} onselect={onMenuSelect} onclose={() => (menu = null)} />
{/if}

{#if pendingRename !== null}
  <ConfirmDialog
    title={m.pipeline_tree_confirm_rename_title()}
    message={m.pipeline_tree_confirm_rename_message({ name: pendingRename })}
    confirmLabel={m.pipeline_tree_confirm_rename_confirm()}
    danger
    onconfirm={() => { tree.renameStage(index, pendingRename!); pendingRename = null; }}
    oncancel={cancelRename}
  />
{/if}

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
