<!-- src/lib/components/CommandLog.svelte -->
<script lang="ts">
  import { commandLog } from "../stores/commandLog.svelte";
  import CommandLogView from "./CommandLogView.svelte";

  let { height, onToggle }: { height: number; onToggle: () => void } = $props();
</script>

<div class="log" style="height:{height}px">
  <header>
    <span class="title">Command log</span>
    <span class="subtitle"><span class="dot">·</span>mongosh</span>
    <span class="actions">
      <button onclick={() => commandLog.clear()}>Clear</button>
      <button aria-label="Toggle command log" onclick={onToggle}>▾</button>
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
    height: 20px;
    flex: none;
    gap: 8px;
    padding: 0 8px;
    background: var(--bg);
    border-bottom: 1px solid #e0e0e0;
    font-size: 11px;
    color: #666;
  }
  .title { font-weight: 600; color: #444; }
  .dot { color: #aaa; }
  .subtitle { color: #666; }
  .actions { margin-left: auto; display: flex; }
  .actions button {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 11px;
    color: #888;
    padding: 2px 6px;
  }
  .actions button:hover { color: var(--fg); }

</style>
