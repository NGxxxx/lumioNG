<script lang="ts">
  import { idJson } from "$lib/domain/docid";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { namespaceTree } from "$lib/stores/namespaceTree.svelte";
  import type { Doc } from "$lib/domain/columns";
  import ConnectionBar from "$lib/components/ConnectionBar.svelte";
  import NamespacePanel from "$lib/components/NamespacePanel.svelte";
  import ResultTable from "$lib/components/ResultTable.svelte";
  import DocumentForm from "$lib/components/DocumentForm.svelte";
  import TabBar from "$lib/components/TabBar.svelte";
  import IndexPanel from "$lib/components/IndexPanel.svelte";
  import CollectionInfoPanel from "$lib/components/CollectionInfoPanel.svelte";
  import DatabaseStatsPanel from "$lib/components/DatabaseStatsPanel.svelte";

  async function onConnected() {
    await namespaceTree.refresh();
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
      <NamespacePanel
        onselect={(d) => workspace.openCollection(d.db, d.coll)}
        onopenindexes={(d) => workspace.openIndexes(d.db, d.coll)}
        onopeninfo={(d) => workspace.openCollectionInfo(d.db, d.coll)}
        onopendbstats={(d) => workspace.openDatabaseStats(d.db)}
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
            {:else if tab.kind === "index"}
              {#key workspace.collectionVersion(tab.db, tab.coll)}
                <IndexPanel db={tab.db} coll={tab.coll} />
              {/key}
            {:else if tab.kind === "collinfo"}
              {#key workspace.collectionVersion(tab.db, tab.coll)}
                <CollectionInfoPanel db={tab.db} coll={tab.coll} />
              {/key}
            {:else if tab.kind === "dbstats"}
              <DatabaseStatsPanel db={tab.db} />
            {:else if tab.kind === "document"}
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
</style>
