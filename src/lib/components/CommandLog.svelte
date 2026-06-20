<!-- src/lib/components/CommandLog.svelte -->
<script lang="ts">
  import { commandLog } from "../stores/commandLog.svelte";

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
  <div class="body">
    {#each commandLog.entries as e (e.n)}
      <div class="line"><span class="n">{e.n}</span><code>{e.text}</code></div>
    {/each}
  </div>
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
  .body {
    flex: 1;
    overflow: auto;
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.55;
    padding: 4px 0;
  }
  .line {
    display: flex;
    padding: 0 8px;
    white-space: pre;
  }
  .line:hover { background: #f2f2f2; }
  .n {
    width: 28px;
    flex: none;
    text-align: right;
    color: #bbb;
    margin-right: 10px;
    user-select: none;
  }
  code { font-family: var(--mono); }
</style>
