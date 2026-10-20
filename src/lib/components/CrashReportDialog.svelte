<!-- src/lib/components/CrashReportDialog.svelte — shown at startup when the previous run crashed; the report stays on this machine. -->
<script lang="ts">
  import { onMount } from "svelte";
  import Modal from "./Modal.svelte";
  import { createCrashReports } from "#lib/stores/diagnostics.svelte.js";
  import { createClipboardCopy } from "#lib/stores/clipboardCopy.js";
  import { toast } from "#lib/stores/toast.svelte.js";
  import * as m from "#lib/paraglide/messages.js";

  const crashes = createCrashReports();
  let copied = $state(false);
  const copyText = createClipboardCopy((msg) => toast.push(msg, "error"));

  onMount(() => void crashes.load());

  async function copy() {
    await copyText(await crashes.reportText());
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

{#if crashes.reports.length > 0}
  <Modal title={m.crash_dialog_title()} width="32rem" ondismiss={crashes.dismiss} onenter={crashes.dismiss}>
    {#snippet body()}
      <p class="msg">{m.crash_dialog_message()}</p>
      <ul class="list">
        {#each crashes.reports as r (r.file)}
          <li><span class="when">{new Date(r.createdMs).toLocaleString()}</span> <span class="mono">{r.summary}</span></li>
        {/each}
      </ul>
    {/snippet}
    {#snippet footer()}
      <button onclick={copy}>{copied ? m.crash_dialog_copied() : m.crash_dialog_copy()}</button>
      <button onclick={crashes.openFolder}>{m.crash_dialog_open_folder()}</button>
      <button class="primary" onclick={crashes.dismiss}>{m.crash_dialog_dismiss()}</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .msg { margin: 0 0 0.75rem; color: var(--fg); }
  .list { margin: 0; padding: 0; list-style: none; max-height: 12rem; overflow: auto; display: flex; flex-direction: column; gap: 0.375rem; }
  .when { color: var(--muted); margin-right: 0.5rem; }
  .mono { font-family: var(--mono); font-size: 0.78125rem; overflow-wrap: anywhere; }
</style>
