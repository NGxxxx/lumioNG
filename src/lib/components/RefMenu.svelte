<!-- src/lib/components/RefMenu.svelte — "where does this ObjectId point?" menu: candidates, any collection, or a whole-database search. Rendering only; logic in stores/refJump. -->
<script lang="ts">
  import type { RefJump } from "../stores/refJump.svelte";
  import { clickOutside } from "../actions/clickOutside";
  import * as m from "#lib/paraglide/messages.js";

  let { jump, collections }: { jump: RefJump; collections: (db: string) => string[] } = $props();

  let choosing = $state(false);
  let q = $state("");
  const menu = $derived(jump.menu);
  // A menu for another click starts fresh (updates of the same menu — not found, searching — keep the filter).
  const input = $derived(menu?.input ?? null);
  $effect(() => {
    void input;
    choosing = false;
    q = "";
  });
  const all = $derived(menu ? collections(menu.input.db).filter((c) => !c.startsWith("system.")) : []);
  const shown = $derived(all.filter((c) => c.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 50));
  const field = $derived(menu ? (menu.input.path.split(".").at(-1) ?? menu.input.path) : "");
  const style = $derived(
    menu?.anchor
      ? `left:${Math.max(8, Math.min(menu.anchor.x, window.innerWidth - 300))}px; top:${Math.min(menu.anchor.y + 4, window.innerHeight - 320)}px`
      : "left:50%; top:30%; transform:translateX(-50%)",
  );

  function onkey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      jump.closeMenu();
    }
  }
</script>

{#if menu}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="refmenu" role="dialog" tabindex="-1" aria-label={m.ref_menu_title()} {style}
    use:clickOutside={() => jump.closeMenu()} onkeydown={onkey}>
    <div class="head">{m.ref_menu_title()}</div>
    {#if menu.notFoundIn}<div class="miss">{m.ref_not_found_in({ coll: menu.notFoundIn })}</div>{/if}
    {#if menu.error}<div class="err">{menu.error}</div>{/if}

    {#if menu.searching}
      <div class="row muted" role="status">{m.ref_search_progress({ done: String(menu.searching.done), total: String(menu.searching.total) })}</div>
      <button class="item" onclick={jump.cancelSearch}>{m.ref_search_cancel()}</button>
    {:else if menu.confirmSearch}
      <div class="row">{m.ref_search_confirm()}</div>
      <div class="actions">
        <button class="item" onclick={jump.closeMenu}>{m.common_cancel()}</button>
        <button class="item strong" onclick={() => void jump.searchAll()}>{m.ref_search_all()}</button>
      </div>
    {:else}
      {#if menu.notFoundAnywhere}<div class="miss">{m.ref_not_found_anywhere()}</div>{/if}
      {#if menu.targets.length}
        <div class="label">{m.ref_look_in()}</div>
        {#each menu.targets as t (t.coll)}
          <button class="item mono" disabled={jump.pending} onclick={() => void jump.pick(t)}>{t.coll}</button>
        {/each}
      {/if}
      {#if choosing}
        <!-- svelte-ignore a11y_autofocus -->
        <input class="filter" bind:value={q} placeholder={m.ref_filter_placeholder()} aria-label={m.ref_filter_placeholder()} autofocus />
        <div class="list">
          {#each shown as c (c)}
            <button class="item mono" disabled={jump.pending || c === menu.notFoundIn} onclick={() => void jump.pick({ db: menu.input.db, coll: c })}>{c}</button>
          {/each}
        </div>
      {:else}
        <button class="item" onclick={() => (choosing = true)}>{m.ref_choose_other()}</button>
      {/if}
      <button class="item" onclick={() => void jump.searchAll()}>{m.ref_search_all()}</button>
      {#if jump.pending}<div class="row muted" role="status">{m.ref_looking()}</div>{/if}
      {#if menu.remembered}
        <div class="remembered">
          <span>{m.ref_remembered({ field, coll: menu.remembered })}</span>
          <button class="link" onclick={jump.forget}>{m.ref_forget()}</button>
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .refmenu {
    position: fixed; z-index: 60; width: 18rem; max-height: 20rem; overflow: auto; padding: 0.375rem;
    border: 1px solid var(--c-surface1); border-radius: var(--radius-lg); background: var(--popover); box-shadow: var(--shadow-sm);
    font-size: 0.75rem;
  }
  .head { padding: 0.25rem 0.375rem 0.375rem; font-weight: 600; }
  .label { padding: 0.25rem 0.375rem 0.125rem; color: var(--muted); font-size: 0.6875rem; }
  .miss { padding: 0.25rem 0.375rem; color: var(--warn-fg); }
  .err { padding: 0.25rem 0.375rem; color: var(--error); }
  .row { padding: 0.25rem 0.375rem; }
  .muted { color: var(--muted); }
  .item { display: block; width: 100%; padding: 0.3125rem 0.375rem; border: none; border-radius: var(--radius-sm); background: none; color: var(--fg); text-align: left; cursor: pointer; }
  .item:hover:not(:disabled) { background: var(--menu-hover); }
  .item:disabled { color: var(--muted); cursor: default; }
  .item.strong { font-weight: 600; color: var(--accent); }
  .mono { font-family: var(--mono); }
  .actions { display: flex; gap: 0.25rem; }
  .filter { width: 100%; box-sizing: border-box; height: 1.625rem; margin: 0.25rem 0; padding: 0 0.375rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--bg); color: var(--fg); }
  .list { max-height: 9rem; overflow: auto; }
  .remembered { display: flex; justify-content: space-between; gap: 0.5rem; margin-top: 0.25rem; padding: 0.375rem; border-top: 1px solid var(--border); color: var(--muted); }
  .link { border: none; background: none; padding: 0; color: var(--link); cursor: pointer; font-size: 0.75rem; }
</style>
