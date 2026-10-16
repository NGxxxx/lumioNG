<!-- Full text of one command-log entry, read back from the log file when memory only holds a preview. -->
<script lang="ts">
  import { onMount } from "svelte";
  import Modal from "./Modal.svelte";
  import { commandLog, type LogEntry } from "../stores/commandLog.svelte";
  import { createClipboardCopy } from "../stores/clipboardCopy";
  import { toast } from "../stores/toast.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { entry, onclose }: { entry: LogEntry; onclose: () => void } = $props();

  let full = $state<{ text: string; complete: boolean } | null>(null);
  const copy = createClipboardCopy((msg) => toast.push(msg, "error"));

  onMount(() => {
    void commandLog.fullText(entry).then((r) => (full = r));
  });

  async function copyAll() {
    if (!full) return;
    await copy(full.text);
    toast.push(m.command_log_copied(), "success");
  }
</script>

<Modal title={m.command_log_full_title({ n: String(entry.n) })} width="44rem" ondismiss={onclose} onenter={onclose}>
  {#snippet body()}
    {#if !full}
      <p class="muted">{m.common_loading()}</p>
    {:else}
      {#if !full.complete}
        <p class="notice">{m.command_log_incomplete({ count: full.text.length.toLocaleString("en-US"), total: entry.length.toLocaleString("en-US") })}</p>
      {/if}
      <pre class="text">{full.text}</pre>
    {/if}
  {/snippet}
  {#snippet footer()}
    <button onclick={copyAll} disabled={!full}>{m.command_log_copy()}</button>
    <button class="primary" onclick={onclose}>{m.common_close()}</button>
  {/snippet}
</Modal>

<style>
  .muted { margin: 0; color: var(--muted); }
  .notice { margin: 0 0 0.625rem; padding: 0.375rem 0.625rem; border-radius: var(--radius); background: var(--warn-bg2); color: var(--warn-fg); font-size: var(--fs); }
  .text {
    margin: 0; max-height: 60vh; overflow: auto; font-family: var(--mono); font-size: var(--fs);
    white-space: pre-wrap; word-break: break-word; user-select: text;
  }
</style>
