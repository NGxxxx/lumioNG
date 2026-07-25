<!-- src/lib/components/AboutDialog.svelte -->
<script lang="ts">
  import { onMount } from "svelte";
  import { portal } from "../actions/portal";
  import { backdropClose } from "../actions/backdropClose";
  import { getAppVersion } from "$lib/api/app";
  import { pushModal } from "$lib/stores/modalStack";
  import { copyToClipboard } from "$lib/clipboard";
  import appIcon from "$lib/assets/app-icon.png";
  import * as m from "$lib/paraglide/messages";

  let { onclose }: { onclose: () => void } = $props();

  const AUTHOR = "NG";
  const BUILT_WITH = "Tauri";

  let version = $state("");
  getAppVersion().then((v) => (version = v)).catch(() => {});

  let copied = $state(false);
  async function copyInfo() {
    const lines = [
      `LumioNG v${version}`,
      `${m.about_dialog_label_author()}: ${AUTHOR}`,
      `${m.about_dialog_label_built_with()}: ${BUILT_WITH}`,
    ];
    if (await copyToClipboard(lines.join("\n"))) {
      copied = true;
      setTimeout(() => (copied = false), 1500);
    }
  }

  onMount(() => pushModal({ onEscape: onclose, onEnter: onclose }));
</script>

<div
  class="backdrop"
  use:portal
  role="presentation"
  use:backdropClose={onclose}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label={m.menu_about()}>
    <div class="body">
      <div class="icon-tile">
        <img class="logo" src={appIcon} alt="" width="64" height="64" />
      </div>
      <div class="name">LumioNG</div>
      <div class="tagline">{m.about_dialog_tagline()} · v{version}</div>

      <div class="info-wrap">
        <table class="info">
          <tbody>
            <tr>
              <td class="label">{m.about_dialog_label_version()}</td>
              <td class="value mono">{version}</td>
            </tr>
            <tr>
              <td class="label">{m.about_dialog_label_author()}</td>
              <td class="value">{AUTHOR}</td>
            </tr>
            <tr>
              <td class="label">{m.about_dialog_label_built_with()}</td>
              <td class="value">{BUILT_WITH}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <footer>
      <button onclick={copyInfo}>{copied ? m.about_dialog_copied() : m.about_dialog_copy_info()}</button>
      <button class="primary" onclick={onclose}>{m.common_close()}</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: var(--panel); width: 22rem; max-width: 90vw; border-radius: 0.375rem; overflow: hidden; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25); }
  .body { padding: 1.75rem 1.25rem 1.25rem; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .icon-tile {
    width: 4.5rem; height: 4.5rem; border-radius: 0.875rem; margin-bottom: 0.875rem;
    display: flex; align-items: center; justify-content: center;
    background: var(--bg); border: 1px solid var(--border);
  }
  .logo { width: 2.75rem; height: 2.75rem; display: block; }
  .name { font-size: 1.0625rem; font-weight: 700; color: var(--fg); letter-spacing: -0.01em; }
  .tagline {
    margin-top: 0.375rem; font-size: 0.6875rem; color: var(--slate); background: var(--blue-tint5);
    padding: 0.125rem 0.5rem; border-radius: 0.1875rem;
  }
  .info-wrap { margin-top: 1rem; width: 100%; border-top: 1px solid var(--bg); padding-top: 0.625rem; display: flex; justify-content: center; }
  .info { border-collapse: collapse; }
  .info td { padding: 0.1875rem 0; font-size: var(--fs); text-align: left; }
  .info .label { color: var(--muted); width: 5.5rem; padding-right: 0.75rem; vertical-align: top; }
  .info .value { color: var(--fg); }
  .info .mono { font-family: var(--mono); }
  footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid var(--bg); }
  footer button { height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  footer button:hover { background: var(--bg); }
  footer button.primary { background: var(--blue-tint5); border-color: var(--blue-tint5); color: var(--slate); }
</style>
