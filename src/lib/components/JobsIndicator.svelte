<!-- src/lib/components/JobsIndicator.svelte — status-bar indicator for background import / export jobs, with a popover listing them. Rendering only; state lives in stores/jobs. -->
<script lang="ts">
  import type { createJobs, JobEntry, JobState } from "../stores/jobs.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { jobs }: { jobs: ReturnType<typeof createJobs> } = $props();

  let open = $state(false);
  const running = $derived(jobs.list.filter((j) => j.finishedAt === null));
  const one = $derived(running.length === 1 ? running[0] : null);

  function pct(j: JobEntry): string {
    const p = j.source.progress();
    return p === null ? "" : ` · ${Math.round(p)}%`;
  }
  function stateLabel(s: JobState): string {
    return s === "running" ? m.jobs_state_running() : s === "done" ? m.jobs_state_done() : s === "failed" ? m.jobs_state_failed() : m.jobs_state_cancelled();
  }
</script>

<svelte:window onclick={() => (open = false)} onkeydown={(e) => { if (e.key === "Escape") open = false; }} />

{#if jobs.list.length > 0}
  <div class="jobs">
    <button
      class="pill"
      class:busy={running.length > 0}
      aria-haspopup="dialog"
      aria-expanded={open}
      onclick={(e) => { e.stopPropagation(); open = !open; }}
    >
      {#if running.length > 0}
        <svg class="spin" aria-hidden="true" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 8a6 6 0 1 1-1.8-4.3" /></svg>
      {:else}
        <svg aria-hidden="true" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8.5l3 3 7-7" /></svg>
      {/if}
      <span>{one ? `${one.source.label}${pct(one)}` : running.length > 1 ? m.jobs_tasks({ count: String(running.length) }) : m.jobs_title()}</span>
      {#if one && one.source.progress() !== null}
        <span class="bar" aria-hidden="true"><span style="width:{one.source.progress()}%"></span></span>
      {/if}
    </button>

    {#if open}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="pop" role="dialog" aria-label={m.jobs_title()} tabindex="-1" onclick={(e) => e.stopPropagation()}>
        <div class="pop-title">{m.jobs_title()}</div>
        {#each jobs.list as j (j.id)}
          {@const st = j.source.state()}
          {@const p = j.source.progress()}
          <div class="job">
            <div class="job-head">
              <span class="job-label">{j.source.label}</span>
              <span class="job-state {st}">{st === "running" && p !== null ? `${Math.round(p)}%` : stateLabel(st)}</span>
            </div>
            <div class="track"><span class:indet={st === "running" && p === null} style="width:{st === 'running' ? (p ?? 30) : 100}%"></span></div>
            <div class="job-actions">
              {#if st === "running" && j.source.cancel}
                <button class="link" onclick={() => jobs.cancel(j.id)}>{m.jobs_cancel()}</button>
              {:else if st !== "running"}
                <button class="link" onclick={() => jobs.dismiss(j.id)}>{m.jobs_dismiss()}</button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .jobs { position: relative; display: inline-flex; }
  .pill {
    display: inline-flex; align-items: center; gap: 0.375rem; height: 1.25rem; padding: 0 0.5rem;
    border: none; border-radius: var(--radius-sm); background: none; color: var(--muted);
    font-size: inherit; cursor: pointer; white-space: nowrap; max-width: 22rem;
  }
  .pill span:not(.bar) { overflow: hidden; text-overflow: ellipsis; }
  .pill:hover { background: var(--hover); color: var(--fg); }
  .pill.busy { color: var(--fg); }
  .bar { width: 3rem; height: 0.1875rem; border-radius: 2px; background: var(--c-surface1); overflow: hidden; flex: none; }
  .bar span { display: block; height: 100%; background: var(--accent); transition: width 0.2s; }
  .spin { animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .pop {
    position: absolute; bottom: calc(100% + 0.375rem); right: 0; width: 20rem; z-index: 50;
    padding: 0.5rem; border: 1px solid var(--c-surface1); border-radius: var(--radius-lg);
    background: var(--popover); box-shadow: var(--shadow-sm); color: var(--fg);
  }
  .pop-title { padding: 0.125rem 0.25rem 0.375rem; color: var(--muted); font-size: 0.6875rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; }
  .job { padding: 0.375rem 0.25rem; border-top: 1px solid var(--border); }
  .job:first-of-type { border-top: none; }
  .job-head { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.75rem; }
  .job-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .job-state { color: var(--muted); flex: none; }
  .job-state.done { color: var(--ok-fg); }
  .job-state.failed { color: var(--error); }
  .track { height: 0.1875rem; margin: 0.375rem 0 0.25rem; border-radius: 2px; background: var(--c-surface1); overflow: hidden; }
  .track span { display: block; height: 100%; background: var(--accent); transition: width 0.2s; }
  .track span.indet { animation: indet 1.2s ease-in-out infinite; }
  @keyframes indet { from { transform: translateX(-100%); } to { transform: translateX(330%); } }
  .job-actions { display: flex; justify-content: flex-end; }
  .link { border: none; background: none; padding: 0; color: var(--link); font-size: 0.75rem; cursor: pointer; }
  .link:hover { text-decoration: underline; }
</style>
