<!-- src/lib/components/SearchIndexPanel.svelte — Atlas Search / Vector Search indexes of a collection with a JSON definition editor. Rendering only; state and rules live in stores/searchIndexView. -->
<script lang="ts">
  import { onMount } from "svelte";
  import type { createSearchIndexView } from "../stores/searchIndexView.svelte";
  import { SEARCH_TEMPLATES, type SearchTemplate } from "../domain/atlas";
  import { msgKey } from "#lib/msgkey.js";
  import DestructiveDialog from "./DestructiveDialog.svelte";
  import CodeEditor from "./CodeEditor.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { view, readOnly = false }: { view: ReturnType<typeof createSearchIndexView>; readOnly?: boolean } = $props();

  onMount(() => void view.load());

  const templateLabel = (id: SearchTemplate["id"]) => msgKey(`search_index_tpl_${id}`);
</script>

<div class="panel">
  <div class="toolbar">
    {#if !readOnly && !view.unsupported}
      <button onclick={() => view.openCreate()}>{m.search_index_create()}</button>
    {/if}
  </div>
  {#if view.unsupported}
    <div class="note" role="status">{m.search_index_unsupported()}</div>
  {/if}
  {#if view.error}<div class="error" role="alert">{view.error}</div>{/if}

  {#if view.editor}
    {@const ed = view.editor}
    <div class="editor">
      {#if ed.mode === "edit"}
        <div class="title">{m.search_index_edit_title({ name: ed.name })}</div>
        <div class="hint">{m.search_index_edit_note()}</div>
      {:else}
        <div class="row">
          <label>{m.search_index_template()}
            <select onchange={(e) => view.applyTemplate(e.currentTarget.value as SearchTemplate["id"])} aria-label={m.search_index_template()}>
              {#each SEARCH_TEMPLATES as t (t.id)}
                <option value={t.id} selected={ed.definition === t.definition}>{templateLabel(t.id)}</option>
              {/each}
            </select>
          </label>
          <label>{m.search_index_name_label()}
            <input value={ed.name} placeholder={m.search_index_name_placeholder()} oninput={(e) => view.setName(e.currentTarget.value)} spellcheck="false" />
          </label>
          <label>{m.search_index_type_label()}
            <select value={ed.type} onchange={(e) => view.setType(e.currentTarget.value === "vectorSearch" ? "vectorSearch" : "search")} aria-label={m.search_index_type_label()}>
              <option value="search">{m.search_index_type_search()}</option>
              <option value="vectorSearch">{m.search_index_type_vector()}</option>
            </select>
          </label>
        </div>
      {/if}
      <div class="label">{m.search_index_definition_label()}</div>
      <div class="jsoneditor"><CodeEditor value={ed.definition} onChange={(v) => view.setDefinition(v)} /></div>
      {#if view.problem}<div class="error" role="alert">{msgKey(`search_index_problem_${view.problem}`)}</div>{/if}
      <footer>
        <button onclick={view.closeEditor} disabled={view.saving}>{m.common_cancel()}</button>
        <button class="primary" onclick={() => void view.requestSave()} disabled={view.saving}>{m.search_index_save()}</button>
      </footer>
    </div>
  {/if}

  {#if !view.unsupported}
    <div class="scroller">
      <table>
        <thead>
          <tr><th>{m.search_index_col_name()}</th><th>{m.search_index_col_type()}</th><th>{m.search_index_col_status()}</th><th>{m.search_index_col_definition()}</th><th class="act"></th></tr>
        </thead>
        <tbody>
          {#each view.rows as row (row.name)}
            <tr>
              <td>{row.name}</td>
              <td>{row.type === "vectorSearch" ? m.search_index_type_vector() : m.search_index_type_search()}</td>
              <td class:ready={row.queryable}>{row.status || "—"}</td>
              <td class="def"><code>{row.definition.replace(/\s+/g, " ")}</code></td>
              <td class="act">
                {#if !readOnly}
                  <button onclick={() => view.openEdit(row.name)}>{m.search_index_edit()}</button>
                  <button class="danger" onclick={() => view.requestDrop(row.name)}>{m.search_index_drop()}</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if view.loading}<div class="status-line">{m.common_loading()}</div>
      {:else if view.loaded && view.rows.length === 0 && !view.error}<div class="status-line">{m.search_index_empty()}</div>{/if}
    </div>
  {/if}
</div>

<DestructiveDialog gate={view.destructive} />

<style>
  .panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .toolbar { display: flex; align-items: center; gap: 0.75rem; padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--bg); }
  .toolbar:empty { display: none; }
  button { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: var(--radius); background: var(--panel); color: var(--fg); cursor: pointer; }
  button:hover:not(:disabled) { background: var(--bg); }
  button:disabled { opacity: 0.5; cursor: default; }
  .primary { background: var(--run); color: var(--on-accent); border-color: transparent; }
  .note { padding: 0.5rem 0.625rem; font-size: 0.8125rem; color: var(--muted); }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; }
  .editor { display: flex; flex-direction: column; gap: 0.375rem; padding: 0.5rem; border-bottom: 1px solid var(--bg); }
  .row { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: end; }
  label { display: flex; flex-direction: column; gap: 0.125rem; font-size: 0.75rem; color: var(--muted); }
  input, select { height: 1.625rem; padding: 0 0.375rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); color: var(--fg); font-size: var(--fs); }
  .title { font-weight: 600; }
  .hint, .label { font-size: 0.75rem; color: var(--muted); }
  .jsoneditor { height: 12rem; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  footer { display: flex; justify-content: flex-end; gap: 0.5rem; }
  .scroller { overflow: auto; flex: 1; }
  table { border-collapse: collapse; width: 100%; font-size: 0.8125rem; }
  th, td { border: 1px solid var(--border); padding: 0.25rem 0.5rem; text-align: left; vertical-align: top; }
  th { position: sticky; top: 0; background: var(--zebra); }
  td.ready { color: var(--accent); }
  .def code { font-family: var(--mono); font-size: 0.75rem; display: block; max-width: 28rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.act, th.act { white-space: nowrap; }
  td.act button { border: none; background: none; padding: 0 0.25rem; }
  .danger { color: var(--error) !important; }
  .status-line { padding: 0.5rem; color: var(--gray-77); font-size: var(--fs); }
</style>
