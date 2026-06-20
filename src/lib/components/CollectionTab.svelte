<script lang="ts">
  import { navigation } from "../stores/navigation.svelte";
  import CollectionInfoPanel from "./CollectionInfoPanel.svelte";
  import IndexPanel from "./IndexPanel.svelte";

  let { db, coll }: { db: string; coll: string } = $props();
</script>

<div class="colltab">
  <div class="subtabs">
    <button class:active={navigation.collectionSection === "info"} onclick={() => navigation.setCollectionSection("info")}>Info</button>
    <button class:active={navigation.collectionSection === "indexes"} onclick={() => navigation.setCollectionSection("indexes")}>Indexes</button>
  </div>
  <div class="subpane">
    {#if navigation.collectionSection === "info"}
      <CollectionInfoPanel {db} {coll} />
    {:else}
      <IndexPanel {db} {coll} />
    {/if}
  </div>
</div>

<style>
  .colltab { display: flex; flex-direction: column; height: 100%; }
  .subtabs { display: flex; border-bottom: 1px solid var(--border); background: var(--bg); }
  .subtabs button { border: none; background: none; padding: 6px 12px; font-size: var(--fs); cursor: pointer; border-right: 1px solid var(--border); }
  .subtabs button.active { background: var(--panel); font-weight: 600; }
  .subpane { flex: 1; min-height: 0; overflow: hidden; }
</style>
