<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createCollectionInfo } from "../stores/collectionInfo.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { formatBytes, formatCount } from "../domain/stats";
  import * as m from "$lib/paraglide/messages";

  let { db, coll }: { db: string; coll: string } = $props();

  const v = untrack(() => createCollectionInfo(sessionManager.active?.id ?? "", db, coll));
  const readOnly = $derived(sessionManager.active?.readOnly ?? false);

  onMount(() => {
    v.init();
  });

  let editingValidator = $state(false);
  let validatorText = $state("{}");
  let validationLevel = $state("strict");
  let validationAction = $state("error");

  function openEditValidator() {
    const o = v.options;
    validatorText = o?.validatorJson ?? "{}";
    validationLevel = o?.validationLevel ?? "strict";
    validationAction = o?.validationAction ?? "error";
    editingValidator = true;
  }

  async function submitValidator() {
    const ok = await v.saveValidator(validatorText, validationLevel, validationAction);
    if (ok) editingValidator = false;
  }
</script>

<div class="infopanel">
  {#if v.error}<div class="error">{v.error}</div>{/if}
  {#if v.loading}<div class="status">{m.common_loading()}</div>{/if}

  {#if v.stats}
    {@const s = v.stats}
    <h3>{m.collection_info_storage_heading()}</h3>
    <table class="kv">
      <tbody>
        <tr><th>{m.collection_info_namespace()}</th><td>{s.ns}</td></tr>
        <tr><th>{m.collection_info_documents()}</th><td>{formatCount(s.count)}</td></tr>
        <tr><th>{m.collection_info_data_size()}</th><td>{formatBytes(s.size)}</td></tr>
        <tr><th>{m.collection_info_avg_obj_size()}</th><td>{formatBytes(s.avgObjSize)}</td></tr>
        <tr><th>{m.collection_info_storage_size()}</th><td>{formatBytes(s.storageSize)}</td></tr>
        <tr><th>{m.collection_info_total_index_size()}</th><td>{formatBytes(s.totalIndexSize)}</td></tr>
        <tr><th>{m.collection_info_indexes()}</th><td>{formatCount(s.nindexes)}</td></tr>
        <tr><th>{m.collection_info_capped()}</th><td>{s.capped ? m.common_yes() : m.common_no()}</td></tr>
      </tbody>
    </table>

    {#if s.indexSizes.length}
      <h3>{m.collection_info_index_sizes_heading()}</h3>
      <table class="kv">
        <tbody>
          {#each s.indexSizes as ix (ix.name)}
            <tr><th>{ix.name}</th><td>{formatBytes(ix.bytes)}</td></tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}

  {#if v.options}
    {@const o = v.options}
    <h3>{m.collection_info_options_heading()}</h3>
    <table class="kv">
      <tbody>
        <tr><th>{m.collection_info_validation_level()}</th><td>{o.validationLevel ?? "—"}</td></tr>
        <tr><th>{m.collection_info_validation_action()}</th><td>{o.validationAction ?? "—"}</td></tr>
        <tr><th>{m.collection_info_capped()}</th><td>{o.capped ? m.common_yes() : m.common_no()}</td></tr>
        {#if o.capped}
          <tr><th>{m.collection_info_capped_size()}</th><td>{formatBytes(o.size)}</td></tr>
          <tr><th>{m.collection_info_max_documents()}</th><td>{formatCount(o.max)}</td></tr>
        {/if}
      </tbody>
    </table>
    {#if !editingValidator}
      {#if o.validatorJson}
        <pre>{o.validatorJson}</pre>
      {:else}
        <div class="muted">{m.collection_info_no_validator()}</div>
      {/if}
      <button class="edit-validator" disabled={readOnly} onclick={openEditValidator}>{m.collection_info_edit_validator()}</button>
    {:else}
      <div class="validator-form">
        <label>{m.collection_info_validator_json_label()}
          <textarea class="validator-json" bind:value={validatorText} spellcheck="false"></textarea>
        </label>
        <div class="validator-row">
          <label>{m.collection_info_validation_level()}
            <select bind:value={validationLevel}>
              <option value="off">off</option>
              <option value="moderate">moderate</option>
              <option value="strict">strict</option>
            </select>
          </label>
          <label>{m.collection_info_validation_action()}
            <select bind:value={validationAction}>
              <option value="error">error</option>
              <option value="warn">warn</option>
            </select>
          </label>
        </div>
        {#if v.validatorError}<div class="error">{v.validatorError}</div>{/if}
        <div class="validator-actions">
          <button onclick={() => (editingValidator = false)} disabled={v.validatorSaving}>{m.common_cancel()}</button>
          <button class="primary" onclick={submitValidator} disabled={v.validatorSaving}>{m.common_save()}</button>
        </div>
      </div>
    {/if}
    {#if o.rawJson !== "{}"}
      <h3>{m.collection_info_raw_options_heading()}</h3>
      <pre>{o.rawJson}</pre>
    {/if}
  {/if}
</div>

<style>
  .infopanel { overflow: auto; height: 100%; box-sizing: border-box; padding: 0.75rem 1rem; font-size: 0.8125rem; }
  h3 { margin: 1rem 0 0.375rem; font-size: 0.8125rem; color: var(--gray-44); }
  h3:first-child { margin-top: 0; }
  table.kv { border-collapse: collapse; user-select: none; }
  table.kv th { text-align: left; font-weight: 500; color: var(--th-fg); padding: 0.1875rem 1rem 0.1875rem 0; vertical-align: top; }
  table.kv td { padding: 0.1875rem 0; font-family: var(--mono); }
  pre { background: var(--zebra); border: 1px solid var(--bg); border-radius: var(--radius); padding: 0.625rem; overflow: auto; font-size: var(--fs); }
  .muted { color: var(--muted); }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; }
  .status { padding: 0.5rem 0; color: var(--gray-77); font-size: var(--fs); }
  .edit-validator { margin-top: 0.5rem; height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: var(--radius); background: var(--panel); color: var(--fg); cursor: pointer; font-size: var(--fs); }
  .edit-validator:hover:not(:disabled) { background: var(--bg); }
  .edit-validator:disabled { color: var(--gray-b8); cursor: default; }
  .validator-form { border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 0.75rem; background: var(--zebra); }
  .validator-form label { display: block; font-size: var(--fs); color: var(--gray-55); }
  .validator-json { width: 100%; box-sizing: border-box; height: 8rem; margin-top: 0.25rem; padding: 0.375rem; font-family: var(--mono); font-size: var(--fs); resize: vertical; }
  .validator-row { display: flex; gap: 1.25rem; margin-top: 0.625rem; }
  .validator-row select { display: block; margin-top: 0.25rem; }
  .validator-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.75rem; }
  .validator-actions button { height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: var(--radius); background: var(--panel); color: var(--fg); cursor: pointer; }
  .validator-actions button:hover:not(:disabled) { background: var(--bg); }
  .validator-actions button:disabled { color: var(--gray-b8); cursor: default; }
  .validator-actions .primary { background: var(--run); color: var(--on-accent); border: none; font-weight: 600; }
  .validator-actions .primary:hover:not(:disabled) { background: var(--run-hover); }
</style>
