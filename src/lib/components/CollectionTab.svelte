<script lang="ts">
  import { sessionManager } from "../stores/sessionManager.svelte";
  import type { CollectionView } from "../stores/navigation.svelte";
  import CollectionInfoPanel from "./CollectionInfoPanel.svelte";
  import IndexPanel from "./IndexPanel.svelte";
  import SchemaPanel from "./SchemaPanel.svelte";

  // Hosts the collection page's non-data views; the view itself is switched from the panel header.
  let { db, coll }: { db: string; coll: string } = $props();

  const view = $derived<CollectionView>(sessionManager.active?.nav.collectionView ?? "info");
</script>

<div class="colltab">
  {#if view === "schema"}
    <SchemaPanel {db} {coll} />
  {:else if view === "indexes"}
    <IndexPanel {db} {coll} />
  {:else}
    <CollectionInfoPanel {db} {coll} />
  {/if}
</div>

<style>
  .colltab { height: 100%; overflow: hidden; }
</style>
