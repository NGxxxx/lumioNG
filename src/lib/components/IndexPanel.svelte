<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createIndexView } from "../stores/indexView.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { describeKeys, type IndexInfo } from "../domain/indexes";
  import DestructiveDialog from "./DestructiveDialog.svelte";
  import IndexCreateForm from "./IndexCreateForm.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { db, coll }: { db: string; coll: string } = $props();

  const v = untrack(() => createIndexView(sessionManager.active?.id ?? "", db, coll));
  let creating = $state(false);

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
      onsubmit={async (fields, unique, name, sparse, ttlSeconds, partialFilter, collation) => {
        await v.create(fields, unique, name, sparse, ttlSeconds, partialFilter, collation);
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
              <button class="danger" disabled={idx.isId} onclick={() => v.requestDrop(idx.name)}>{m.index_panel_drop()}</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if v.loading}<div class="status">{m.common_loading()}</div>{/if}
  </div>
</div>

<DestructiveDialog gate={v.destructive} />

<style>
  .indexpanel { display: flex; flex-direction: column; height: 100%; }
  .toolbar { padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--bg); }
  .toolbar button { height: 1.5rem; padding: 0 0.625rem; border: 1px solid var(--gray-b8); border-radius: var(--radius); background: var(--panel); color: var(--fg); cursor: pointer; }
  .toolbar button:hover { background: var(--bg); }
  .scroller { overflow: auto; flex: 1; }
  table { border-collapse: collapse; width: 100%; font-size: 0.8125rem; user-select: none; }
  th, td { border: 1px solid var(--border); padding: 0.25rem 0.5rem; text-align: left; }
  th { position: sticky; top: 0; background: var(--zebra); }
  .keys { font-family: var(--mono); }
  td.act, th.act { white-space: nowrap; }
  td.act button { border: none; background: none; cursor: pointer; }
  td.act button:disabled { cursor: default; }
  .danger { color: var(--error); }
  .danger:disabled { color: var(--gray-b8); }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; }
  .status { padding: 0.5rem; color: var(--gray-77); font-size: var(--fs); }
</style>
