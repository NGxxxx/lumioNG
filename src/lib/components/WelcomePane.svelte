<!-- Shown in the work area while no session is open: one-click recent connections and paste-to-connect. -->
<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { vault } from "../stores/vault.svelte";
  import { createConnectionRegistry, type ConnectRequest } from "../stores/connections.svelte";
  import type { SavedConnection } from "../api/connections";
  import EnvBadge from "./EnvBadge.svelte";
  import { SHORTCUTS } from "../domain/commands";
  import { formatCombo } from "../domain/shortcuts";
  import { detectPlatform } from "../stores/platform";
  import * as m from "#lib/paraglide/messages.js";

  let {
    onconnected,
    onnewconnection,
  }: {
    onconnected: (c: ConnectRequest) => Promise<boolean>;
    onnewconnection: () => void;
  } = $props();

  const RECENT_LIMIT = 6;
  const plat = detectPlatform();
  const tips = [
    { label: m.palette_open(), keys: formatCombo(SHORTCUTS["view.commandPalette"]!, plat) },
    { label: m.peek_quick_look(), keys: "Space" },
    { label: m.menu_run_query(), keys: formatCombo(SHORTCUTS["query.run"]!, plat) },
    { label: m.menu_keyboard_shortcuts(), keys: "?" },
  ];
  const r = createConnectionRegistry();
  onMount(() => void r.load());
  // Unlocking (or erasing) the vault changes which passwords the saved connections carry.
  $effect(() => {
    if (vault.epoch > 0) untrack(() => void r.load());
  });

  const recent = $derived(r.list.slice(0, RECENT_LIMIT));
  let uriText = $state("");
  let busyId = $state<number | "uri" | null>(null);
  let error = $state<string | null>(null);

  async function connect(req: ConnectRequest | null, busy: number | "uri") {
    if (!req) {
      error = r.error;
      return;
    }
    error = null;
    busyId = busy;
    try {
      if (!(await onconnected(req))) error = m.session_manager_connect_failed();
    } finally {
      busyId = null;
    }
  }

  function connectSaved(c: SavedConnection) {
    if (busyId !== null) return;
    r.edit(c);
    void connect(r.connectRequest(), c.id);
  }

  function connectUri() {
    if (busyId !== null || !uriText.trim()) return;
    r.clearForm();
    if (!r.fillFromUri(uriText).ok) {
      error = m.welcome_paste_invalid();
      return;
    }
    void connect(r.connectRequest(), "uri");
  }
</script>

<div class="welcome">
  <h2>{m.welcome_title()}</h2>

  <form class="paste" onsubmit={(e) => { e.preventDefault(); connectUri(); }}>
    <input
      bind:value={uriText}
      placeholder={m.welcome_paste_placeholder()}
      aria-label={m.welcome_paste_placeholder()}
      spellcheck="false"
      autocomplete="off"
      disabled={busyId !== null}
    />
    <button type="submit" class="primary" disabled={busyId !== null || !uriText.trim()}>
      {#if busyId === "uri"}<span class="spinner" aria-hidden="true"></span>{/if}{m.welcome_connect()}
    </button>
  </form>

  {#if error}<div class="error" role="alert">{error}</div>{/if}

  {#if recent.length}
    <section>
      <h3>{m.welcome_recent()}</h3>
      <ul>
        {#each recent as c (c.id)}
          <li>
            <button class="conn" disabled={busyId !== null} onclick={() => connectSaved(c)} title={r.uriOf(c, false)}>
              <span class="dot" style:background={c.color || "var(--c-overlay1)"}></span>
              <span class="label">{c.label}</span>
              <EnvBadge env={c.environment ?? ""} />
              <span class="host">{c.sshEnabled ? `${c.host} ⇢ ssh ${c.sshHost}` : c.host}</span>
              {#if busyId === c.id}<span class="spinner" aria-hidden="true"></span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <button class="link" onclick={onnewconnection}>{m.welcome_new_connection()}</button>

  <section class="tips">
    <h3>{m.welcome_tips()}</h3>
    <dl>
      {#each tips as t (t.label)}<dt><kbd>{t.keys}</kbd></dt><dd>{t.label}</dd>{/each}
    </dl>
  </section>
</div>

<style>
  .welcome {
    height: 100%; display: flex; flex-direction: column; justify-content: center;
    width: min(32rem, 100% - 2rem); margin: 0 auto; gap: 0.875rem; font-size: var(--fs);
  }
  h2 { margin: 0; font-size: 1rem; font-weight: 600; color: var(--fg); }
  h3 { margin: 0 0 0.375rem; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
  .paste { display: flex; gap: 0.5rem; }
  .paste input {
    flex: 1; min-width: 0; height: 2rem; padding: 0 0.625rem; font-family: var(--mono); font-size: var(--fs);
    border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); color: var(--fg);
  }
  .paste input:focus { outline: none; border-color: var(--accent); }
  .paste button {
    height: 2rem; display: inline-flex; align-items: center; gap: 0.375rem; padding: 0 0.875rem;
    border: 1px solid transparent; border-radius: var(--radius); font-size: var(--fs); font-weight: 600; cursor: pointer;
  }
  .primary { background: var(--run); color: var(--on-accent); }
  .primary:hover:not(:disabled) { background: var(--run-hover); }
  .primary:disabled { opacity: 0.5; cursor: default; }
  .error { color: var(--danger); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
  .conn {
    width: 100%; display: flex; align-items: center; gap: 0.5rem; height: 2.125rem; padding: 0 0.625rem;
    border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); color: var(--fg);
    font-size: var(--fs); text-align: left; cursor: pointer;
  }
  .conn:hover:not(:disabled) { border-color: var(--c-surface1); background: var(--hover); }
  .dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; flex: none; }
  .label { font-weight: 500; white-space: nowrap; }
  .host { margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-family: var(--mono); font-size: 0.75rem; }
  .tips { margin-top: 0.75rem; }
  .tips dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.3125rem 0.75rem; margin: 0; align-items: center; }
  .tips dd { margin: 0; color: var(--muted); }
  .tips kbd {
    font-family: var(--mono); font-size: 0.6875rem; color: var(--c-subtext1); padding: 0.0625rem 0.375rem;
    border-radius: var(--radius-sm); background: var(--hover); border: 1px solid var(--border);
  }
  .link { align-self: flex-start; padding: 0; border: 0; background: none; color: var(--accent); font-size: var(--fs); cursor: pointer; }
  .link:hover { text-decoration: underline; }
  .spinner {
    width: 0.75rem; height: 0.75rem; border: 2px solid currentColor; border-right-color: transparent;
    border-radius: 50%; animation: spin 0.8s linear infinite; flex: none;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
