<script lang="ts">
  import { listNamespaces, errorMessage, type DbInfo } from "$lib/ipc";
  import ConnectionBar from "$lib/components/ConnectionBar.svelte";
  import NamespaceTree from "$lib/components/NamespaceTree.svelte";
  import ResultTable from "$lib/components/ResultTable.svelte";

  let databases = $state<DbInfo[]>([]);
  let selected = $state<{ db: string; coll: string } | null>(null);
  let treeError = $state<string | null>(null);

  async function onConnected() {
    treeError = null;
    try {
      databases = await listNamespaces();
    } catch (e) {
      treeError = errorMessage(e);
    }
  }
</script>

<main>
  <ConnectionBar onconnected={onConnected} />
  <div class="body">
    <aside>
      {#if treeError}<div class="error">{treeError}</div>{/if}
      <NamespaceTree {databases} {selected} onselect={(d) => (selected = d)} />
    </aside>
    <section>
      {#if selected}
        {#key `${selected.db}.${selected.coll}`}
          <ResultTable db={selected.db} coll={selected.coll} />
        {/key}
      {:else}
        <div class="empty">Chọn một collection để xem dữ liệu</div>
      {/if}
    </section>
  </div>
</main>

<style>
  :global(body, html) { margin: 0; height: 100%; }
  main { display: flex; flex-direction: column; height: 100vh; font-family: system-ui, sans-serif; }
  .body { display: flex; flex: 1; min-height: 0; }
  aside { width: 240px; border-right: 1px solid #ddd; display: flex; flex-direction: column; }
  section { flex: 1; min-width: 0; }
  .empty { padding: 24px; color: #888; }
  .error { background: #fdecea; color: #b71c1c; padding: 6px 10px; font-size: 12px; }
</style>
