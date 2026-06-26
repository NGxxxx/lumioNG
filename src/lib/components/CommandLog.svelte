<!-- src/lib/components/CommandLog.svelte -->
<script lang="ts">
  import { commandLog } from "../stores/commandLog.svelte";
  import CommandLogView from "./CommandLogView.svelte";
  import * as m from "$lib/paraglide/messages";

  let { height, onToggle }: { height: number; onToggle: () => void } = $props();
</script>

<div class="log" style="height:{height}px">
  <header>
    <span class="title">{m.command_log_title()}</span>
    <span class="subtitle"><span class="dot">·</span>{m.command_log_subtitle()}</span>
    <span class="actions">
      <button onclick={() => commandLog.clear()}>{m.command_log_clear()}</button>
      <button aria-label={m.command_log_toggle()} onclick={onToggle}>▾</button>
    </span>
  </header>
  <CommandLogView />
</div>

<style>
  .log {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
    background: var(--panel);
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

</style>
