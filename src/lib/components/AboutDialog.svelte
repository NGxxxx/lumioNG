<!-- src/lib/components/AboutDialog.svelte — Help › About (F1): the logo, what the app is, and the exact build (copyable for bug reports). -->
<script lang="ts">
  import Modal from "./Modal.svelte";
  import { appVersion as getAppVersion, appInfo as getAppInfo, openLink } from "#lib/stores/desktop.js";
  import { createClipboardCopy } from "#lib/stores/clipboardCopy.js";
  import { toast } from "#lib/stores/toast.svelte.js";
  import { infoText, platformLabel, webviewName, REPO_URL, REPO_LABEL, KOFI_URL, SPONSOR_URL, type AppInfo } from "#lib/domain/aboutInfo.js";
  import appIcon from "#lib/assets/app-icon.png";
  import * as m from "#lib/paraglide/messages.js";

  let { onclose }: { onclose: () => void } = $props();

  const AUTHOR = "NG";

  let version = $state("");
  let info = $state.raw<AppInfo | null>(null);
  let copied = $state(false);
  getAppVersion().then((v) => (version = v)).catch(() => {});
  getAppInfo().then((i) => (info = i)).catch(() => {}); // outside the desktop shell: version only

  const copyText = createClipboardCopy((msg) => toast.push(msg, "error"));
  async function copyInfo() {
    if (!info) return;
    await copyText(infoText(info));
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  function openExternal(e: MouseEvent, url: string) {
    e.preventDefault(); // the webview must not navigate away; the system browser opens it
    openLink(url).catch((err) => toast.push(String(err), "error"));
  }
</script>

<Modal title={m.menu_about()} width="26rem" ondismiss={onclose} onenter={onclose}>
  {#snippet body()}
    <div class="about">
      <img class="logo" src={appIcon} alt="" width="88" height="88" />
      <h2 class="name">Lumio<span class="ng">NG</span></h2>
      <p class="tagline">{m.about_dialog_tagline()}</p>

      <dl class="facts">
        <dt>{m.about_dialog_label_version()}</dt>
        <dd class="mono">{info?.version ?? version}</dd>
        {#if info}
          <dt>{m.about_dialog_label_build()}</dt>
          <dd class="mono">{info.commit} · {info.buildDate}</dd>
          <dt>{m.about_dialog_label_platform()}</dt>
          <dd>{platformLabel(info.os, info.arch)}</dd>
          {#if info.webview}
            <dt>{webviewName(info.os)}</dt>
            <dd class="mono">{info.webview}</dd>
          {/if}
        {/if}
        <dt>{m.about_dialog_label_author()}</dt>
        <dd>{AUTHOR}</dd>
        <dt>{m.about_dialog_label_source()}</dt>
        <dd><a class="link" href={REPO_URL} onclick={(e) => openExternal(e, REPO_URL)}>{REPO_LABEL}</a></dd>
      </dl>
      <p class="sponsor">
        ♥ {m.about_dialog_sponsor()}
        <a class="link" href={KOFI_URL} onclick={(e) => openExternal(e, KOFI_URL)}>Ko-fi</a> ·
        <a class="link" href={SPONSOR_URL} onclick={(e) => openExternal(e, SPONSOR_URL)}>GitHub Sponsors</a>
      </p>
    </div>
  {/snippet}
  {#snippet footer()}
    {#if info}
      <button onclick={copyInfo}>{copied ? m.about_dialog_copied() : m.about_dialog_copy()}</button>
    {/if}
    <button class="primary" onclick={onclose}>{m.common_close()}</button>
  {/snippet}
</Modal>

<style>
  .about { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 0.5rem 0 0.25rem; }
  .logo { width: 5.5rem; height: 5.5rem; display: block; }
  .name { margin: 0.75rem 0 0; font-size: 1.625rem; font-weight: 600; letter-spacing: -0.02em; color: var(--fg); line-height: 1.15; }
  .ng { color: var(--accent); }
  .tagline { margin: 0.375rem 0 0; font-size: var(--fs); color: var(--muted); }
  .facts {
    display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.4375rem 1rem; align-items: baseline;
    width: 100%; box-sizing: border-box; margin: 1.25rem 0 0; padding: 0.875rem 1rem;
    border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg); text-align: left;
  }
  dt { color: var(--muted); font-size: var(--fs); }
  dd { margin: 0; color: var(--fg); font-size: var(--fs); overflow-wrap: anywhere; }
  .mono { font-family: var(--mono); font-size: 0.78125rem; }
  .link { color: var(--accent); text-decoration: none; }
  .link:hover { text-decoration: underline; }
  .sponsor { margin: 0.875rem 0 0; font-size: var(--fs); color: var(--muted); }
</style>
