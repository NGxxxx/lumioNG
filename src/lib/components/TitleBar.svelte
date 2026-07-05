<script lang="ts">
  import { buildBreadcrumb } from "$lib/domain/breadcrumb";
  import { minimize, toggleMaximize } from "$lib/api/window";
  import * as m from "$lib/paraglide/messages";

  let {
    conn,
    db,
    coll,
    onquit,
  }: {
    conn: string | null;
    db: string | null;
    coll: string | null;
    onquit: () => void;
  } = $props();

  const APP_VERSION = "LumioNG 0.1.0";
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
  <span class="crumb">{crumb} — {APP_VERSION}</span>
  <div class="wbtns">
    <button class="wbtn" title={m.title_bar_minimize()} onclick={minimize} aria-label={m.title_bar_minimize()}>
      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11"><rect x="1" y="5" width="9" height="1" fill="var(--fg)" /></svg>
    </button>
    <button class="wbtn" title={m.title_bar_maximize()} onclick={toggleMaximize} aria-label={m.title_bar_maximize()}>
      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11"><rect x="1" y="1" width="9" height="9" fill="none" stroke="var(--fg)" stroke-width="1" /></svg>
    </button>
    <button class="wbtn close" title={m.title_bar_close()} onclick={onquit} aria-label={m.title_bar_close()}>
      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11"><path d="M1 1 L10 10 M10 1 L1 10" stroke="var(--fg)" stroke-width="1.1" /></svg>
    </button>
  </div>
</div>

<style>
  .titlebar {
    display: flex; align-items: center; height: 2rem; flex: none;
    background: var(--panel); border-bottom: 1px solid var(--border);
    padding-left: 0.625rem; user-select: none;
  }
  .logo { flex: none; }
  .crumb { margin-left: 0.5rem; font-size: 0.75rem; color: var(--gray-33); }
  .wbtns { margin-left: auto; display: flex; height: 100%; }
  .wbtn {
    width: 2.875rem; height: 100%; border: none; background: transparent;
    display: flex; align-items: center; justify-content: center; cursor: default; padding: 0;
  }
  .wbtn:hover { background: var(--tab-inactive-bg); }
  .wbtn.close:hover { background: var(--danger); }
  .wbtn.close:hover :global(path) { stroke: var(--panel); }
</style>
