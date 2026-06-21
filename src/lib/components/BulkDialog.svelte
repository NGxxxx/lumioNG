<script lang="ts">
  import { portal } from "../actions/portal";

  let {
    mode,
    scope,
    appliedFilter,
    isEmpty,
    selectionCount,
    updateText = $bindable(),
    updateError,
    count,
    counting,
    running,
    result,
    error,
    canRun,
    oncount,
    onrun,
    onclose,
  }: {
    mode: "update" | "delete";
    scope: "selection" | "filter";
    appliedFilter: string;
    isEmpty: boolean;
    selectionCount: number;
    updateText: string;
    updateError: string | null;
    count: number | null;
    counting: boolean;
    running: boolean;
    result: string | null;
    error: string | null;
    canRun: boolean;
    oncount: () => void;
    onrun: () => void;
    onclose: () => void;
  } = $props();

  const heading = $derived(
    scope === "selection"
      ? mode === "update"
        ? "Update selected"
        : "Delete selected"
      : mode === "update"
        ? "Update many"
        : "Delete many",
  );
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} />

<div
  class="backdrop"
  use:portal
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
>
  <div class="modal" role="dialog" aria-modal="true">
    <header>{heading}</header>
    <div class="body">
      {#if scope === "selection"}
        <div class="row">{selectionCount} dòng đã chọn.</div>
      {:else}
        <div class="row">Filter đang áp: <code>{appliedFilter}</code></div>
        {#if isEmpty}
          <div class="warn">
            Filter rỗng — khi Run, bạn sẽ phải gõ tên collection để xác nhận áp dụng cho
            <b>TOÀN BỘ</b> collection.
          </div>
        {/if}
      {/if}
      {#if mode === "update"}
        <label class="ulabel">Update document (operator)
          <textarea bind:value={updateText} rows="4" placeholder={'{ "$set": { "field": value } }'}></textarea>
        </label>
        {#if updateError}<div class="err">{updateError}</div>{/if}
      {/if}
      {#if scope === "filter"}
        <div class="counter">
          <button onclick={oncount} disabled={counting}>Count</button>
          {#if count !== null}<span>Khớp {count} document.</span>{/if}
        </div>
      {/if}
      {#if result}<div class="ok">{result}</div>{/if}
      {#if error}<div class="err">{error}</div>{/if}
    </div>
    <footer>
      <button onclick={onclose}>Close</button>
      <button class="danger" disabled={!canRun} onclick={onrun}>
        {running ? "Đang chạy…" : mode === "update" ? "Update" : "Delete"}
      </button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; }
  .modal { background: #fff; width: 480px; max-width: 92vw; border-radius: 6px; overflow: hidden; }
  header { padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #eee; }
  .body { padding: 14px; font-size: 13px; display: flex; flex-direction: column; gap: 10px; }
  code { background: #f3f3f3; padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, monospace; }
  .warn { background: #fff4e5; border: 1px solid #ffb74d; padding: 8px; border-radius: 4px; }
  .ulabel { display: flex; flex-direction: column; gap: 4px; }
  textarea { font-family: ui-monospace, monospace; font-size: 12px; }
  .counter { display: flex; align-items: center; gap: 8px; }
  .ok { color: #1b5e20; }
  .err { color: #b71c1c; }
  footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid #eee; }
  .danger { color: #b71c1c; }
</style>
