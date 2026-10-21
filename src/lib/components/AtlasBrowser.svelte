<!-- src/lib/components/AtlasBrowser.svelte — pick an Atlas cluster through the Admin API (Service Account) and prefill the connection form. Rendering only; see stores/atlasBrowser. -->
<script lang="ts">
  import { onMount } from "svelte";
  import { createAtlasBrowser } from "../stores/atlasBrowser.svelte";
  import { clusterStatus } from "../domain/atlas";
  import * as m from "#lib/paraglide/messages.js";

  let { onpick }: { onpick: (uri: string, label: string) => void } = $props();
  // `b.pick` stores the connection string for the connection form; `onpick` just tells the parent to open it.

  const b = createAtlasBrowser();
  onMount(() => void b.init());

  function use(i: number) {
    const picked = b.pick(b.clusters[i]);
    if (picked) onpick(picked.uri, picked.label);
  }
</script>

<section class="atlas" aria-label={m.atlas_browser_title()}>
  <h3>{m.atlas_browser_title()}</h3>
  <p class="help">{m.atlas_browser_help()}</p>

  <form onsubmit={(e) => { e.preventDefault(); void b.signIn(); }}>
    <input bind:value={b.clientId} placeholder={m.atlas_client_id()} aria-label={m.atlas_client_id()} spellcheck="false" autocomplete="off" />
    <input
      type="password" bind:value={b.secret} autocomplete="off" spellcheck="false"
      placeholder={b.hasSaved ? m.atlas_secret_saved() : m.atlas_client_secret()} aria-label={m.atlas_client_secret()}
    />
    <button type="submit" class="primary" disabled={b.loading || !b.clientId.trim() || (!b.secret && !b.hasSaved)}>{m.atlas_sign_in()}</button>
  </form>
  {#if b.hasSaved}
    <div class="actions">
      <button type="button" class="link" onclick={() => void b.refresh()} disabled={b.loading}>{m.atlas_refresh()}</button>
      <button type="button" class="link" onclick={() => void b.signOut()}>{m.atlas_sign_out()}</button>
    </div>
  {/if}
  {#if b.note}<div class="note" role="status">{b.note}</div>{/if}
  {#if b.error}<div class="error" role="alert">{b.error}</div>{/if}
  {#if b.loading}<div class="note">{m.common_loading()}</div>{/if}

  {#if b.projects.length > 0}
    <label class="project">{m.atlas_project()}
      <select value={b.projectId} onchange={(e) => void b.selectProject(e.currentTarget.value)}>
        <option value="">{m.atlas_project_pick()}</option>
        {#each b.projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
      </select>
    </label>
  {/if}

  {#if b.projectId && !b.loading}
    {#if b.clusters.length === 0 && !b.error}
      <div class="note">{m.atlas_no_clusters()}</div>
    {:else if b.clusters.length > 0}
      <h4>{m.atlas_clusters()}</h4>
      <ul>
        {#each b.clusters as c, i (c.name)}
          <li>
            <span class="name">{c.name}</span>
            <span class="meta">{c.clusterType} · {c.mongoVersion || "—"} · {c.state}</span>
            {#if clusterStatus(c) === "ready"}
              <button type="button" class="use" onclick={() => use(i)}>{m.atlas_use_cluster()}</button>
            {:else}
              <span class="meta" title={m.atlas_no_connection()}>{m.atlas_no_connection()}</span>
            {/if}
          </li>
        {/each}
      </ul>
      <p class="help">{m.atlas_user_hint()}</p>
    {/if}
  {/if}
</section>

<style>
  .atlas { display: flex; flex-direction: column; gap: 0.5rem; font-size: var(--fs); }
  h3 { margin: 0; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
  h4 { margin: 0.25rem 0 0; font-size: 0.75rem; color: var(--muted); }
  .help, .note, .meta { font-size: 0.75rem; color: var(--muted); margin: 0; }
  form { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  input, select { height: 2rem; padding: 0 0.5rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); color: var(--fg); font-size: var(--fs); min-width: 0; }
  form input { flex: 1 1 10rem; font-family: var(--mono); }
  input:focus, select:focus { outline: none; border-color: var(--accent); }
  button { height: 2rem; padding: 0 0.875rem; border: 1px solid transparent; border-radius: var(--radius); cursor: pointer; font-size: var(--fs); }
  button:disabled { opacity: 0.5; cursor: default; }
  .primary { background: var(--run); color: var(--on-accent); font-weight: 600; }
  .actions { display: flex; gap: 1rem; }
  .link { height: auto; padding: 0; background: none; color: var(--accent); }
  .link:hover:not(:disabled) { text-decoration: underline; }
  .project { display: flex; flex-direction: column; gap: 0.125rem; font-size: 0.75rem; color: var(--muted); }
  .error { color: var(--danger); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
  li { display: flex; align-items: center; gap: 0.5rem; min-height: 2.125rem; padding: 0 0.625rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); }
  .name { font-weight: 500; }
  .meta { margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  li .use { margin-left: 0; height: 1.5rem; padding: 0 0.625rem; background: var(--run); color: var(--on-accent); }
</style>
