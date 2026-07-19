<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createIndexView } from "../stores/indexView.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { describeKeys, type IndexInfo } from "../domain/indexes";
  import { pushModal } from "$lib/stores/modalStack";
  import IndexCreateForm from "./IndexCreateForm.svelte";
  import * as m from "$lib/paraglide/messages";

  let { db, coll }: { db: string; coll: string } = $props();

  const v = untrack(() => createIndexView(sessionManager.active?.id ?? "", db, coll));
  let creating = $state(false);
  let confirmDrop = $state<string | null>(null);

  function flags(idx: IndexInfo): string {
    const f: string[] = [];
    if (idx.unique) f.push("unique");
    if (idx.sparse) f.push("sparse");
    if (idx.ttl !== null) f.push(`ttl=${idx.ttl}s`);
    return f.length ? f.join(", ") : "—";
  }

  onMount(() => {
    v.init();
  });

  $effect(() => {
    const target = confirmDrop;
    if (!target) return;
    return pushModal({
      onEscape: () => (confirmDrop = null),
      onEnter: async () => { await v.drop(target); confirmDrop = null; },
    });
  });
</script>

<div class="indexpanel">
  <div class="toolbar">
    <button onclick={() => (creating = true)}>{m.index_panel_create()}</button>
  </div>
  {#if v.error}<div class="error">{v.error}</div>{/if}
  {#if creating}
    <IndexCreateForm
      onsubmit={async (fields, unique, name) => {
        await v.create(fields, unique, name);
        creating = false;
      }}
      oncancel={() => (creating = false)}
    />
  {/if}
  <div class="scroller">
    <table>
      <thead>
        <tr><th>{m.index_panel_col_name()}</th><th>{m.index_panel_col_keys()}</th><th>{m.index_panel_col_flags()}</th><th class="act"></th></tr>
      </thead>
      <tbody>
        {#each v.indexes as idx (idx.name)}
          <tr>
            <td>{idx.name}</td>
            <td class="keys">{describeKeys(idx.entries)}</td>
            <td>{flags(idx)}</td>
            <td class="act">
              <button class="danger" disabled={idx.isId} onclick={() => (confirmDrop = idx.name)}>{m.index_panel_drop()}</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if v.loading}<div class="status">{m.common_loading()}</div>{/if}
  </div>
</div>

{#if confirmDrop}
  {@const target = confirmDrop}
  <div
    class="backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) confirmDrop = null;
    }}
  >
    <div class="modal" role="dialog" aria-modal="true" aria-label={m.index_panel_drop_title()}>
      <header>{m.index_panel_drop_title()}</header>
      <div class="body">{m.index_panel_drop_body_prefix()} <code>{target}</code>{m.index_panel_drop_body_suffix()}</div>
      <footer>
        <button onclick={() => (confirmDrop = null)}>{m.common_cancel()}</button>
        <button
          class="danger"
          onclick={async () => {
            await v.drop(target);
            confirmDrop = null;
          }}>{m.index_panel_drop()}</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .indexpanel { display: flex; flex-direction: column; height: 100%; }
  .toolbar { padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--bg); }
  .toolbar button { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  .toolbar button:hover { background: var(--bg); }
  .scroller { overflow: auto; flex: 1; }
  table { border-collapse: collapse; width: 100%; font-size: 0.8125rem; user-select: none; }
  th, td { border: 1px solid var(--border); padding: 0.25rem 0.5rem; text-align: left; }
  th { position: sticky; top: 0; background: var(--zebra); }
  .keys { font-family: ui-monospace, monospace; }
  td.act, th.act { white-space: nowrap; }
  td.act button { border: none; background: none; cursor: pointer; }
  td.act button:disabled { cursor: default; }
  .danger { color: var(--error); }
  .danger:disabled { color: var(--gray-b8); }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; }
  .status { padding: 0.5rem; color: var(--gray-77); font-size: 0.75rem; }
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: var(--panel); width: 26.25rem; max-width: 90vw; border-radius: 0.375rem; overflow: hidden; }
  header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid var(--bg); }
  .body { padding: 0.875rem; font-size: 0.8125rem; }
  code { background: var(--bg); padding: 0.0625rem 0.25rem; border-radius: 0.1875rem; font-family: ui-monospace, monospace; }
  footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid var(--bg); }
  footer button { height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  footer button:hover:not(:disabled) { background: var(--bg); }
  footer button:disabled { color: var(--gray-b8); cursor: default; }
</style>
