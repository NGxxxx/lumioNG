<script lang="ts">
  let {
    idText,
    onconfirm,
    oncancel,
  }: {
    idText: string;
    onconfirm: () => void;
    oncancel: () => void;
  } = $props();
</script>

<div class="backdrop" role="presentation" onclick={oncancel}>
  <div class="modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
    <header>Xóa document?</header>
    <div class="body">
      Bạn sắp xóa document có <code>_id</code> = <code>{idText}</code>.
      Hành động này không hoàn tác được.
    </div>
    <footer>
      <button onclick={oncancel}>Cancel</button>
      <button class="danger" onclick={onconfirm}>Delete</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: #fff; width: 420px; max-width: 90vw; border-radius: 6px; overflow: hidden; }
  header { padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #eee; }
  .body { padding: 14px; font-size: 13px; }
  code { background: #f3f3f3; padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, monospace; }
  footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid #eee; }
  .danger { color: #b71c1c; }
</style>
