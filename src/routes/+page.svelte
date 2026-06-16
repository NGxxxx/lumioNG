<script lang="ts">
  import { listNamespaces, errorMessage, idJson, type DbInfo } from "$lib/ipc";
  import { workspace } from "$lib/workspace.svelte";
  import type { Doc } from "$lib/columns";
  import ConnectionBar from "$lib/components/ConnectionBar.svelte";
  import NamespaceTree from "$lib/components/NamespaceTree.svelte";
  import ResultTable from "$lib/components/ResultTable.svelte";
  import DocumentForm from "$lib/components/DocumentForm.svelte";
  import TabBar from "$lib/components/TabBar.svelte";

  let databases = $state<DbInfo[]>([]);
  let treeError = $state<string | null>(null);

  async function onConnected() {
    treeError = null;
    try {
      databases = await listNamespaces();
    } catch (e) {
      treeError = errorMessage(e);
    }
  }

  function openDocument(db: string, coll: string, doc: Doc | null, mode: "edit" | "insert") {
    workspace.openDocument({
      kind: "document",
      db,
      coll,
      mode,
      initial: doc,
      idText: mode === "edit" && doc ? idJson(doc) : null,
    });
  }
</script>

<main>
  <ConnectionBar onconnected={onConnected} />
  <div class="body">
    <aside>
      {#if treeError}<div class="error">{treeError}</div>{/if}
      <NamespaceTree
        {databases}
        selected={null}
        onselect={(d) => workspace.openCollection(d.db, d.coll)}
      />
    </aside>
    <section>
      <TabBar
        tabs={workspace.tabs}
        activeId={workspace.activeId}
        onactivate={(id) => workspace.activate(id)}
        onclose={(id) => workspace.close(id)}
      />
      <div class="panes">
        {#each workspace.tabs as tab (tab.id)}
          <div class="tabpane" hidden={tab.id !== workspace.activeId}>
            {#if tab.kind === "collection"}
              {#key workspace.collectionVersion(tab.db, tab.coll)}
                <ResultTable
                  db={tab.db}
                  coll={tab.coll}
                  onopendocument={(doc, mode) => openDocument(tab.db, tab.coll, doc, mode)}
                />
              {/key}
            {:else}
              <DocumentForm
                mode={tab.mode}
                db={tab.db}
                coll={tab.coll}
                initial={tab.initial}
                onsaved={() => {
                  workspace.bumpCollection(tab.db, tab.coll);
                  workspace.close(tab.id);
                }}
                oncancel={() => workspace.close(tab.id)}
              />
            {/if}
          </div>
        {/each}
        {#if workspace.tabs.length === 0}
          <div class="empty">Chọn một collection để xem dữ liệu</div>
        {/if}
      </div>
    </section>
  </div>
</main>

<style>
  :global(body, html) { margin: 0; height: 100%; }
  main { display: flex; flex-direction: column; height: 100vh; font-family: system-ui, sans-serif; }
  .body { display: flex; flex: 1; min-height: 0; }
  aside { width: 240px; border-right: 1px solid #ddd; display: flex; flex-direction: column; }
  section { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .panes { flex: 1; min-height: 0; position: relative; }
  .tabpane { height: 100%; }
  .tabpane[hidden] { display: none; }
  .empty { padding: 24px; color: #888; }
  .error { background: #fdecea; color: #b71c1c; padding: 6px 10px; font-size: 12px; }
</style>
