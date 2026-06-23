<script lang="ts">
  import { portal } from "../actions/portal";
  import * as m from "$lib/paraglide/messages";

  type Scope =
    | { kind: "collection"; coll: string }
    | { kind: "filter" }
    | { kind: "selection"; count: number };
  let { scope, onexport, oncancel }: {
    scope: Scope;
    onexport: (format: "json" | "csv" | "bson") => void;
    oncancel: () => void;
  } = $props();

  let format = $state<"json" | "csv" | "bson">("json");

  const summary = $derived(
    scope.kind === "selection"
      ? scope.count === 1
        ? m.export_dialog_summary_selection_one({ count: scope.count })
        : m.export_dialog_summary_selection_many({ count: scope.count })
      : scope.kind === "filter"
        ? m.export_dialog_summary_filter()
        : m.export_dialog_summary_collection({ coll: scope.coll }),
  );
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && oncancel()} />

<div class="backdrop" use:portal role="presentation" onclick={(e) => { if (e.target === e.currentTarget) oncancel(); }}>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Export">
    <header>{m.export_dialog_title()}</header>
    <div class="body">
      <p class="summary">{summary}</p>
      <fieldset>
        <legend>{m.export_dialog_format_legend()}</legend>
        <label><input type="radio" name="fmt" value="json" checked bind:group={format} /> JSON</label>
        <label><input type="radio" name="fmt" value="csv" bind:group={format} /> CSV</label>
        <label><input type="radio" name="fmt" value="bson" bind:group={format} /> BSON (mongodump)</label>
      </fieldset>
    </div>
    <footer>
      <button onclick={oncancel}>{m.common_cancel()}</button>
      <button class="primary" onclick={() => onexport(format)}>{m.export_dialog_export()}</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.3); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .modal { background: #fff; width: 380px; max-width: 90vw; border-radius: 6px; overflow: hidden; }
  header { padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #eee; }
  .body { padding: 14px; font-size: 13px; }
  .summary { margin: 0 0 10px; color: #444; }
  fieldset { border: 1px solid #e2e2e2; border-radius: 4px; padding: 8px 10px; }
  legend { font-size: 12px; color: #777; padding: 0 4px; }
  label { display: block; padding: 3px 0; }
  footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid #eee; }
  .primary { font-weight: 600; }
</style>
