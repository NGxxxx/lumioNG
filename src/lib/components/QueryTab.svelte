<script lang="ts">
  let { db, coll }: { db: string; coll: string } = $props();
</script>

<div class="query">
  <div class="bar">
    <span><b>Query</b> — {db}.{coll}</span>
    <span class="muted">aggregate pipeline</span>
    <button class="run" disabled>▶ Run pipeline</button>
  </div>
  <div class="editor">
    <div class="gutter">1<br />2<br />3</div>
    <pre class="code">db.{coll}.aggregate([
  {`{ $match: { } }`}
])</pre>
  </div>
  <div class="results">Aggregate — sẽ phát triển (D4).</div>
</div>

<style>
  .query { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .bar { display: flex; align-items: center; gap: 10px; height: 28px; flex: none; background: var(--panel); border-bottom: 1px solid #e2e2e2; padding: 0 10px; }
  .muted { color: var(--muted); }
  .run { margin-left: auto; height: 21px; padding: 0 12px; background: #1f9d4d; color: #fff; border: none; border-radius: 3px; font-weight: 600; opacity: 0.6; }
  .editor { height: 46%; flex: none; background: #fffef9; border-bottom: 1px solid #d0d0d0; overflow: auto; display: flex; font-family: var(--mono); font-size: 13px; line-height: 1.6; }
  .gutter { width: 42px; flex: none; text-align: right; color: #bbb; padding: 8px 8px 0 0; user-select: none; border-right: 1px solid #eee; background: #faf9f3; }
  .code { margin: 0; padding: 8px 12px; white-space: pre; }
  .results { flex: 1; overflow: auto; background: var(--panel); padding: 8px 12px; color: var(--muted); }
</style>
