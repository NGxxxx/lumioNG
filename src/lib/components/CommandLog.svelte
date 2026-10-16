<!-- src/lib/components/CommandLog.svelte -->
<script lang="ts">
  import { commandLog, commandLogFolder, deleteCommandLogFiles } from "../stores/commandLog.svelte";
  import { settings } from "../stores/settings.svelte";
  import { createClipboardCopy } from "../stores/clipboardCopy";
  import { toast } from "../stores/toast.svelte";
  import { errorMessage } from "../api/errors";
  import CommandLogView from "./CommandLogView.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import { msgCount } from "#lib/msgkey.js";
  import * as m from "#lib/paraglide/messages.js";

  let { height, onToggle }: { height: number; onToggle: () => void } = $props();

  let confirmDelete = $state(false);
  const copyText = createClipboardCopy((msg) => toast.push(msg, "error"));

  async function copyFolder() {
    try {
      await copyText(await commandLogFolder());
      toast.push(m.command_log_path_copied(), "success");
    } catch (e) {
      toast.push(errorMessage(e), "error");
    }
  }

  async function deleteFiles() {
    confirmDelete = false;
    try {
      toast.push(msgCount("command_log_files_deleted", await deleteCommandLogFiles()), "success");
    } catch (e) {
      toast.push(errorMessage(e), "error");
    }
  }
</script>

<div class="log" style="height:{height}px">
  <header>
    <span class="title">{m.command_log_title()}</span>
    <span class="subtitle"><span class="dot">·</span>{m.command_log_subtitle()}</span>
    <span class="actions">
      {#if commandLog.fileError}
        <span class="file-error" title={commandLog.fileError}>{m.command_log_file_error()}</span>
      {/if}
      <label class="to-file" title={m.command_log_to_file_title()}>
        <input type="checkbox" checked={settings.commandLogToFile} onchange={(e) => settings.setCommandLogToFile(e.currentTarget.checked)} />
        {m.command_log_to_file()}
      </label>
      <button onclick={copyFolder} title={m.command_log_copy_path_title()}>{m.command_log_copy_path()}</button>
      <button onclick={() => (confirmDelete = true)}>{m.command_log_clear_files()}</button>
      <button onclick={() => commandLog.clear()}>{m.command_log_clear()}</button>
      <button aria-label={m.command_log_toggle()} onclick={onToggle}>▾</button>
    </span>
  </header>
  <CommandLogView />
</div>

{#if confirmDelete}
  <ConfirmDialog
    title={m.command_log_clear_files_title()}
    message={m.command_log_clear_files_message()}
    confirmLabel={m.command_log_clear_files()}
    danger
    onconfirm={deleteFiles}
    oncancel={() => (confirmDelete = false)}
  />
{/if}

<style>
  .log {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
    background: var(--panel);
    /* Isolates rendering from the rest of the page — avoids a WebView2 compositing glitch
       where a heavy sidebar can bleed through this panel. */
    contain: paint;
  }
  header {
    display: flex;
    align-items: center;
    height: 1.25rem;
    flex: none;
    gap: 0.5rem;
    padding: 0 0.5rem;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    font-size: 0.6875rem;
    color: var(--th-fg);
  }
  .title { font-weight: 600; color: var(--gray-44); }
  .dot { color: var(--gray-aa); }
  .subtitle { color: var(--th-fg); }
  .actions { margin-left: auto; display: flex; }
  .actions button {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 0.6875rem;
    color: var(--muted);
    padding: 0.125rem 0.375rem;
  }
  .actions button:hover { color: var(--fg); }
  .to-file { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0 0.375rem; color: var(--muted); cursor: pointer; }
  .to-file input { margin: 0; width: 0.6875rem; height: 0.6875rem; }
  .to-file:hover { color: var(--fg); }
  .file-error { align-self: center; padding: 0 0.375rem; color: var(--danger); cursor: help; }

</style>
