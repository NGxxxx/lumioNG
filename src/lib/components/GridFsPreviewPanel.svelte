<!-- src/lib/components/GridFsPreviewPanel.svelte -->
<script lang="ts">
  import { untrack, onMount } from "svelte";
  import {
    classifyPreviewKind,
    GRIDFS_PREVIEW_CAP_BYTES,
    base64ToUtf8Text,
    imageMimeType,
  } from "../domain/gridfsPreview";
  import { gridfsPreviewBytes } from "../api/gridfs";
  import { createGridfsDownload } from "../stores/gridfsDownload.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { errorMessage } from "../api/errors";
  import { portal } from "../actions/portal";
  import { backdropClose } from "../actions/backdropClose";
  import { pushModal } from "../stores/modalStack";
  import type { GridfsFileRow } from "../domain/gridfsFiles";
  import * as m from "#lib/paraglide/messages.js";

  let { db, bucket, row, onclose }: { db: string; bucket: string; row: GridfsFileRow; onclose: () => void } = $props();

  const sessionId = untrack(() => sessionManager.active?.id ?? "");
  const download = untrack(() => createGridfsDownload(sessionId, db, bucket));
  const kind = $derived(classifyPreviewKind(row.filename, row.contentType));
  const overCap = $derived(row.length !== null && row.length > GRIDFS_PREVIEW_CAP_BYTES);

  let base64 = $state<string | null>(null);
  let loading = $state(untrack(() => !overCap && kind !== "unknown"));
  let error = $state<string | null>(null);

  onMount(() => pushModal({ onEscape: onclose }));

  $effect(() => {
    // Reset stale state from a previous `row` before (re-)fetching -- currently unreachable in the
    // UI (the fixed backdrop blocks other clicks while a preview is open), but kept so a future
    // next/prev navigation feature can't leak the old file's preview/error while the new one loads.
    base64 = null;
    error = null;
    if (overCap || kind === "unknown") {
      loading = false;
      return;
    }
    loading = true;
    let cancelled = false;
    gridfsPreviewBytes(sessionId, db, bucket, row.doc)
      .then((b64) => {
        if (!cancelled) {
          base64 = b64;
          loading = false;
        }
      })
      .catch((e) => {
        if (!cancelled) {
          error = e instanceof Error ? e.message : errorMessage(e);
          loading = false;
        }
      });
    return () => {
      cancelled = true;
    };
  });

  const dataUrl = $derived.by(() => {
    if (base64 === null) return null;
    const mime =
      kind === "image"
        ? imageMimeType(row.filename, row.contentType)
        : kind === "pdf"
          ? "application/pdf"
          : "application/octet-stream";
    return `data:${mime};base64,${base64}`;
  });
  const textContent = $derived(base64 !== null && kind === "text" ? base64ToUtf8Text(base64) : null);
</script>

<div class="gridfs-preview-overlay" use:portal role="presentation" use:backdropClose={onclose}>
  <div class="gridfs-preview" role="dialog" aria-modal="true" aria-label={row.filename ?? ""}>
    <div class="gridfs-preview-header">
      <span>{row.filename}</span>
      <button onclick={onclose}>{m.common_close()}</button>
    </div>
    <div class="gridfs-preview-body">
      {#if overCap}
        <p>{m.gridfs_preview_cap_message()}</p>
      {:else if loading}
        <p>{m.gridfs_preview_loading()}</p>
      {:else if error}
        <p class="gridfs-error">{m.gridfs_preview_error({ error })}</p>
      {:else if kind === "image" && dataUrl}
        <img src={dataUrl} alt={row.filename ?? ""} />
      {:else if kind === "pdf" && dataUrl}
        <div class="gridfs-pdf-preview">
          <embed type="application/pdf" src={dataUrl} />
          <!-- Inline PDF rendering depends on the OS webview (WebView2/WKWebView/WebKitGTK) and
               can silently fail to render; always offer a working escape hatch alongside it. -->
          <p class="gridfs-pdf-fallback">
            <a href={dataUrl} download={row.filename ?? "download.pdf"}>{m.gridfs_pdf_fallback_link()}</a>
          </p>
        </div>
      {:else if kind === "text" && textContent !== null}
        <pre>{textContent}</pre>
      {:else}
        <p>{m.gridfs_preview_unsupported()}</p>
      {/if}
    </div>
    <div class="gridfs-preview-footer">
      <button onclick={() => download.start(row.doc, row.filename ?? "download", row.length ?? 0)}>
        {m.gridfs_download_button()}
      </button>
      {#if download.status === "running"}
        {#if download.total > 0}
          <span>{m.gridfs_download_progress({ done: download.done, total: download.total })}</span>
        {:else}
          <!-- Unknown/zero declared length (missing or malformed GridFS metadata) -- show bytes
               downloaded so far instead of a bogus "X / 0" fraction. -->
          <span>{m.gridfs_download_progress_indeterminate({ done: download.done })}</span>
        {/if}
        <button onclick={download.cancel}>{m.gridfs_download_cancel()}</button>
      {:else if download.status === "error"}
        <span class="gridfs-error">{m.gridfs_download_error({ error: download.error ?? "" })}</span>
      {:else if download.status === "cancelled"}
        <span>{m.gridfs_download_cancelled()}</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .gridfs-preview-overlay {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }
  .gridfs-preview {
    width: min(640px, 90vw);
    max-height: 80vh;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
  }
  .gridfs-preview-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border);
    font-size: var(--fs);
  }
  .gridfs-preview-body {
    flex: 1;
    min-height: 8rem;
    overflow: auto;
    padding: 0.75rem;
  }
  .gridfs-preview-body img {
    max-width: 100%;
  }
  .gridfs-preview-body embed {
    width: 100%;
    height: 60vh;
  }
  .gridfs-pdf-preview {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .gridfs-pdf-fallback {
    text-align: center;
    font-size: var(--fs);
  }
  .gridfs-preview-body pre {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .gridfs-preview-footer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-top: 1px solid var(--border);
    font-size: var(--fs);
  }
  .gridfs-error {
    color: var(--danger, #c0392b);
  }
</style>
