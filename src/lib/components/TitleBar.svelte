<script lang="ts">
  import { onMount, onDestroy, type Snippet } from "svelte";
  import { buildBreadcrumb } from "#lib/domain/breadcrumb.js";
  import { windowControls, appVersion as getAppVersion } from "#lib/stores/desktop.js";
  const { minimize, toggleMaximize, isMaximized, onMaximizedChange } = windowControls;
  import * as m from "#lib/paraglide/messages.js";
  import EnvBadge from "./EnvBadge.svelte";
  import type { Environment } from "#lib/domain/environment.js";

  let {
    conn,
    db,
    coll,
    onquit,
    onpalette,
    paletteHint = "",
    menus,
    env = "",
  }: {
    conn: string | null;
    db: string | null;
    coll: string | null;
    onquit: () => void;
    /** Opens the command palette; the search pill is hidden when absent. */
    onpalette?: () => void;
    /** Formatted shortcut shown inside the search pill (e.g. "Ctrl+K"). */
    paletteHint?: string;
    /** App menus (MenuBar) rendered inline after the logo — one row instead of two. */
    menus?: Snippet;
    /** Environment of the session in focus; shown as a chip before the breadcrumb. */
    env?: Environment;
  } = $props();

  let appVersion = $state("");
  getAppVersion().then((v) => (appVersion = v)).catch(() => {});

  let maximized = $state(false);
  let unlisten: (() => void) | undefined;
  onMount(async () => {
    maximized = await isMaximized();
    unlisten = await onMaximizedChange((v) => (maximized = v));
  });
  onDestroy(() => unlisten?.());

  const crumb = $derived(buildBreadcrumb({ conn, db, coll }));
</script>

<div class="titlebar" data-tauri-drag-region>
  <!-- The folded-L cat, small variant (src-tauri/icons/source/logo-16.svg — no star/inner ears, which
       blur at 16 px). Gradient ids are prefixed so they can't clash with other inline SVGs. -->
  <svg class="logo" width="16" height="16" viewBox="0 0 96 96" aria-hidden="true">
    <defs>
      <linearGradient id="titlebar-logo-g" x1="18" y1="14" x2="78" y2="82" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#b4b8ff"/><stop offset=".5" stop-color="#7b80ea"/><stop offset="1" stop-color="#5a4cc0"/></linearGradient>
      <linearGradient id="titlebar-logo-ft" x1="28" y1="72" x2="80" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4d42b4"/><stop offset=".55" stop-color="#5f58d2"/><stop offset="1" stop-color="#8c91f0"/></linearGradient>
      <linearGradient id="titlebar-logo-fd" x1="28" y1="60" x2="46" y2="77" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3a3190"/><stop offset="1" stop-color="#2f2878"/></linearGradient>
    </defs>
    <g transform="translate(48 48) scale(1.26) translate(-52.3 -43.25)" stroke-linejoin="round">
      <path d="M28.5 23.5 30.6 9.5 39.4 22.5ZM35.6 22.5 44.4 9.5 46.5 23.5ZM28 22H46V60L28 77Z" fill="url(#titlebar-logo-g)" stroke="url(#titlebar-logo-g)" stroke-width="2.6"/>
      <path d="M28 77 46 60H57.5C63.6 60 66.6 57 67.1 51.6L67.9 42.6C68.2 39.6 70.2 38 72.6 38C75 38 76.8 39.8 76.6 42.8L75.9 52.6C75.1 68.6 67.6 77 56.5 77Z" fill="url(#titlebar-logo-ft)" stroke="url(#titlebar-logo-ft)" stroke-width="2.6"/>
      <path d="M28 77 46 60V77Z" fill="url(#titlebar-logo-fd)" stroke="url(#titlebar-logo-fd)" stroke-width="2.6"/>
    </g>
  </svg>
  {#if menus}<div class="menus">{@render menus()}</div>{/if}
  {#if env}<EnvBadge {env} size="md" />{/if}
  <span class="crumb" data-tauri-drag-region>{crumb}{appVersion ? ` — v${appVersion}` : ""}</span>
  {#if onpalette}
    <button class="search" onclick={onpalette} aria-label={m.palette_open()}>
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" />
      </svg>
      <span class="search-label">{m.palette_open()}</span>
      {#if paletteHint}<kbd>{paletteHint}</kbd>{/if}
    </button>
  {/if}
  <div class="wbtns">
    <button class="wbtn" title={m.title_bar_minimize()} onclick={minimize} aria-label={m.title_bar_minimize()}>
      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11"><rect x="1" y="5" width="9" height="1" fill="currentColor" /></svg>
    </button>
    <button
      class="wbtn"
      title={maximized ? m.title_bar_restore() : m.title_bar_maximize()}
      onclick={toggleMaximize}
      aria-label={maximized ? m.title_bar_restore() : m.title_bar_maximize()}
    >
      {#if maximized}
        <svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11">
          <rect x="1" y="3" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1" />
          <path d="M3 3 V1 H10 V8 H8" fill="none" stroke="currentColor" stroke-width="1" />
        </svg>
      {:else}
        <svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11"><rect x="1" y="1" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1" /></svg>
      {/if}
    </button>
    <button class="wbtn close" title={m.title_bar_close()} onclick={onquit} aria-label={m.title_bar_close()}>
      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11"><path d="M1 1 L10 10 M10 1 L1 10" stroke="currentColor" stroke-width="1.1" /></svg>
    </button>
  </div>
</div>

<style>
  /* One row of window chrome: logo + menus | drag area with breadcrumb | search | window buttons. */
  .titlebar {
    display: flex; align-items: center; gap: 0.25rem; height: 2.375rem; flex: none;
    background: var(--app-bg);
    padding-left: 0.75rem; user-select: none;
  }
  .logo { flex: none; margin-right: 0.25rem; }
  .menus { flex: none; display: flex; align-items: center; }
  .crumb {
    flex: 1; min-width: 0; align-self: stretch; display: flex; align-items: center; justify-content: center;
    font-size: 0.75rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .search {
    flex: 0 1 17.5rem; min-width: 8rem; display: flex; align-items: center; gap: 0.5rem;
    height: 1.625rem; padding: 0 0.5rem 0 0.625rem; margin-right: 0.5rem;
    border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel);
    color: var(--muted); font-size: 0.75rem; cursor: pointer;
  }
  .search:hover { color: var(--fg); border-color: var(--c-surface1); }
  .search-label { flex: 1; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  kbd {
    font-family: var(--mono); font-size: 0.6875rem; color: var(--muted);
    padding: 0.0625rem 0.3125rem; border-radius: var(--radius-sm);
    background: var(--hover); border: 1px solid var(--border);
  }
  .wbtns { display: flex; height: 100%; }
  .wbtn {
    width: 2.75rem; height: 100%; border: none; background: transparent; color: var(--muted);
    display: flex; align-items: center; justify-content: center; cursor: default; padding: 0;
  }
  .wbtn:hover { background: var(--hover); color: var(--fg); }
  .wbtn.close:hover { background: var(--danger); color: #ffffff; }
</style>
