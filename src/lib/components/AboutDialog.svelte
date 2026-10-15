<!-- src/lib/components/AboutDialog.svelte -->
<script lang="ts">
  import Modal from "./Modal.svelte";
  import { appVersion as getAppVersion } from "#lib/stores/desktop.js";
  import appIcon from "#lib/assets/app-icon.png";
  import * as m from "#lib/paraglide/messages.js";

  let { onclose }: { onclose: () => void } = $props();

  const AUTHOR = "NG";
  const BUILT_WITH = "Tauri";

  let version = $state("");
  getAppVersion().then((v) => (version = v)).catch(() => {});
</script>

<Modal title={m.menu_about()} width="22rem" ondismiss={onclose} onenter={onclose}>
  {#snippet body()}
    <div class="about-body">
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
  {/snippet}
  {#snippet footer()}
    <button class="primary" onclick={onclose}>{m.common_close()}</button>
  {/snippet}
</Modal>

<style>
  .about-body { display: flex; flex-direction: column; align-items: center; text-align: center; }
  .icon-tile {
    width: 4.5rem; height: 4.5rem; border-radius: 0.875rem; margin-bottom: 0.875rem;
    display: flex; align-items: center; justify-content: center;
    background: var(--bg); border: 1px solid var(--border);
  }
  .logo { width: 2.75rem; height: 2.75rem; display: block; }
  .name { font-size: 1.0625rem; font-weight: 700; color: var(--fg); letter-spacing: -0.01em; }
  .tagline {
    margin-top: 0.375rem; font-size: 0.6875rem; color: var(--slate); background: var(--blue-tint5);
    padding: 0.125rem 0.5rem; border-radius: var(--radius);
  }
  .info-wrap { margin-top: 1rem; width: 100%; border-top: 1px solid var(--bg); padding-top: 0.625rem; display: flex; justify-content: center; }
  .info { border-collapse: collapse; }
  .info td { padding: 0.1875rem 0; font-size: var(--fs); text-align: left; }
  .info .label { color: var(--muted); width: 5.5rem; padding-right: 0.75rem; vertical-align: top; }
  .info .value { color: var(--fg); }
  .info .mono { font-family: var(--mono); }
</style>
