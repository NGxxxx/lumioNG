<script lang="ts">
  import { sessionManager } from "../stores/sessionManager.svelte";
  import type { CollectionSection } from "../stores/navigation.svelte";
  import CollectionInfoPanel from "./CollectionInfoPanel.svelte";
  import IndexPanel from "./IndexPanel.svelte";
  import SchemaPanel from "./SchemaPanel.svelte";
  import * as m from "$lib/paraglide/messages";

  let { db, coll }: { db: string; coll: string } = $props();

  const nav = $derived(sessionManager.active?.nav ?? null);
  const section = $derived<CollectionSection>(nav?.collectionSection ?? "info");
  const setSection = (s: CollectionSection) => nav?.setCollectionSection(s);
</script>

<div class="colltab">
  <div class="subtabs">
    <button class:active={section === "info"} onclick={() => setSection("info")}>{m.collection_tab_info()}</button>
    <button class:active={section === "schema"} onclick={() => setSection("schema")}>{m.collection_tab_schema()}</button>
    <button class:active={section === "indexes"} onclick={() => setSection("indexes")}>{m.collection_tab_indexes()}</button>
  </div>
  <div class="subpane">
    {#if section === "info"}
      <CollectionInfoPanel {db} {coll} />
    {:else if section === "schema"}
      <SchemaPanel {db} {coll} />
    {:else}
      <IndexPanel {db} {coll} />
    {/if}
  </div>
</div>

<style>
  .colltab { display: flex; flex-direction: column; height: 100%; }
  .subtabs { display: flex; border-bottom: 1px solid var(--border); background: var(--bg); }
  .subtabs button { border: none; background: none; color: var(--fg); padding: 0.375rem 0.75rem; font-size: var(--fs); cursor: pointer; border-right: 1px solid var(--border); }
  .subtabs button.active { background: var(--panel); font-weight: 600; }
  .subpane { flex: 1; min-height: 0; overflow: hidden; }
</style>
