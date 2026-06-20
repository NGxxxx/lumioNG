<script lang="ts">
  let { connection }: { connection: { label: string; uri: string } | null } = $props();
</script>

<div class="host">
  <div class="title">{connection?.label ?? "—"}</div>
  <div class="sub">{connection?.uri ?? "—"}</div>
  <table>
    <tbody>
      <tr><td class="k">version</td><td class="v">—</td></tr>
      <tr><td class="k">storageEngine</td><td class="v">—</td></tr>
      <tr><td class="k">uptime</td><td class="v">—</td></tr>
      <tr><td class="k">connections.current</td><td class="v">—</td></tr>
    </tbody>
  </table>
  <p class="note">Chưa triển khai — serverStatus (D3 sẽ điền số liệu thật).</p>
</div>

<style>
  .host { flex: 1; overflow: auto; background: var(--panel); padding: 14px 18px; }
  .title { font-size: 14px; font-weight: 600; margin-bottom: 3px; }
  .sub { color: #777; margin-bottom: 14px; }
  table { border-collapse: collapse; width: 560px; font-size: 12px; }
  .k { padding: 4px 10px; border: 1px solid var(--cell-border); color: #555; width: 240px; }
  .v { padding: 4px 10px; border: 1px solid var(--cell-border); color: #1a1a1a; font-family: var(--mono); }
  .note { color: var(--muted); margin-top: 14px; }
</style>
