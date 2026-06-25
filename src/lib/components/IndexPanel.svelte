<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createIndexView } from "../stores/indexView.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { describeKeys, type IndexInfo } from "../domain/indexes";
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

<svelte:window onkeydown={(e) => confirmDrop && e.key === "Escape" && (confirmDrop = null)} />

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
  .toolbar { padding: 0.375rem 0.5rem; border-bottom: 1px solid #eee; }
  .scroller { overflow: auto; flex: 1; }
  table { border-collapse: collapse; width: 100%; font-size: 0.8125rem; }
  th, td { border: 1px solid #e0e0e0; padding: 0.25rem 0.5rem; text-align: left; }
  th { position: sticky; top: 0; background: #f5f5f5; }
  .keys { font-family: ui-monospace, monospace; }
  td.act, th.act { white-space: nowrap; }
  .danger { color: #b71c1c; }
  .danger:disabled { color: #bbb; }
  .error { background: #fdecea; color: #b71c1c; padding: 0.375rem 0.625rem; }
  .status { padding: 0.5rem; color: #777; font-size: 0.75rem; }
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: #fff; width: 26.25rem; max-width: 90vw; border-radius: 0.375rem; overflow: hidden; }
  header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid #eee; }
  .body { padding: 0.875rem; font-size: 0.8125rem; }
  code { background: #f3f3f3; padding: 0.0625rem 0.25rem; border-radius: 0.1875rem; font-family: ui-monospace, monospace; }
  footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid #eee; }
</style>
