<script lang="ts">
  import { untrack } from "svelte";
  import { portal } from "../actions/portal";
  import { createImportJob } from "../stores/importJob.svelte";
  import * as m from "$lib/paraglide/messages";

  let { sessionId, db, coll, path, onclose }: {
    sessionId: string;
    db: string;
    coll: string;
    path: string;
    onclose: () => void;
  } = $props();

  const job = untrack(() => createImportJob({ sessionId, db, coll, path }));
  job.run();

  let showErrors = $state(false);
  const fileName = $derived(path.replace(/^.*[\\/]/, ""));
  const percent = $derived(job.total > 0 ? Math.round((job.done / job.total) * 100) : 0);
</script>

<svelte:window onkeydown={(e) => { if (e.key === "Escape" && !job.running) onclose(); }} />

<div
  class="backdrop"
  use:portal
  role="presentation"
  onclick={(e) => { if (e.target === e.currentTarget && !job.running) onclose(); }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label={m.import_dialog_title({ db, coll })}>
    <header>{m.import_dialog_title({ db, coll })}</header>
    <div class="body">
      <div class="file-row"><span class="label">{m.import_dialog_file_label()}</span><span class="path">{fileName}</span></div>

      {#if job.total > 0}
        <div class="progress">
          <div class="bar"><div class="fill" style="width:{percent}%"></div></div>
          <span>{m.import_dialog_progress({ done: job.done, total: job.total })}</span>
        </div>
      {:else if job.running}
        <div class="progress-unknown">{m.import_dialog_progress_unknown()}</div>
      {/if}

      {#if job.error}
        <div class="error">{m.import_dialog_error_title()}: {job.error}</div>
      {:else if job.result}
        {@const r = job.result}
        <div class="io-ok">{m.namespace_panel_import_done({ inserted: r.inserted, failed: r.failed })}</div>
        {#if r.errors.length > 0}
          <button type="button" class="link" onclick={() => (showErrors = !showErrors)}>
            {m.import_dialog_view_errors({ count: r.errors.length })}
          </button>
          {#if showErrors}
            <ul class="errlist">
              {#each r.errors as e}<li>{e}</li>{/each}
            </ul>
          {/if}
        {/if}
      {/if}
    </div>
    <footer>
      <button type="button" class="primary" onclick={onclose} disabled={job.running}>{m.common_close()}</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .3); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .modal { background: var(--panel); width: 30rem; max-width: 94vw; border-radius: 0.375rem; overflow: hidden; box-shadow: 0 10px 40px rgba(0, 0, 0, .25); }
  header { padding: 0.625rem 0.875rem; font-weight: 600; border-bottom: 1px solid var(--bg); }
  .body { padding: 0.875rem; font-size: 0.8125rem; }
  .file-row { display: flex; gap: 0.5rem; margin-bottom: 0.625rem; }
  .label { color: var(--gray-77); }
  .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .progress { display: flex; align-items: center; gap: 0.5rem; }
  .bar { flex: 1; height: 0.5rem; background: var(--bg); border-radius: 0.25rem; overflow: hidden; }
  .fill { height: 100%; background: var(--progress); transition: width .2s; }
  .progress-unknown { color: var(--gray-77); }
  .io-ok { background: var(--ok-bg); color: var(--ok-fg); padding: 0.375rem 0.625rem; font-size: 0.75rem; margin-top: 0.625rem; border-radius: 0.1875rem; }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; font-size: 0.75rem; margin-top: 0.625rem; border-radius: 0.1875rem; }
  .link { border: none; background: none; color: var(--link-strong); cursor: pointer; padding: 0; font-size: 0.75rem; margin-top: 0.5rem; }
  .link:hover { text-decoration: underline; }
  .errlist { margin: 0.375rem 0 0; padding-left: 1.125rem; max-height: 8rem; overflow: auto; font-size: 0.75rem; color: var(--error); }
  footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.625rem 0.875rem; border-top: 1px solid var(--bg); }
  footer button { height: 1.75rem; padding: 0 0.875rem; border: 1px solid var(--gray-b8); border-radius: 0.1875rem; background: var(--panel); color: var(--fg); cursor: pointer; }
  footer button:hover:not(:disabled) { background: var(--bg); }
  footer button:disabled { color: var(--gray-b8); cursor: default; }
  footer .primary { background: var(--run); color: var(--panel); border: none; font-weight: 600; }
  footer .primary:hover:not(:disabled) { background: var(--run-hover); }
</style>
