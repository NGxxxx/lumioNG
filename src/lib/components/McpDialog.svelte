<!-- McpDialog — built-in MCP server: on/off, port, write access, token, client setup snippets, recent tool calls. State lives in stores/mcp. -->
<script lang="ts">
  import Modal from "./Modal.svelte";
  import { mcp } from "../stores/mcp.svelte";
  import { sessionManager } from "../stores/sessionManager.svelte";
  import { clientSnippets, endpointUrl, exposedSessions, fieldsFromText, fieldsToText, isValidPort, type McpClientId } from "../domain/mcp";
  import { copyToClipboard } from "../clipboard";
  import { msgCount } from "#lib/msgkey.js";
  import * as m from "#lib/paraglide/messages.js";

  let { onclose }: { onclose: () => void } = $props();

  let portText = $state(String(mcp.port));
  let redactText = $state(fieldsToText(mcp.redactFields));
  const portOk = $derived(isValidPort(Number(portText)));
  let showToken = $state(false);
  let client = $state<McpClientId>("claude-code");
  let copied = $state<string | null>(null);

  const snippets = $derived(clientSnippets(mcp.port, mcp.token));
  const snippet = $derived(snippets.find((s) => s.id === client) ?? snippets[0]);
  const exposed = $derived(exposedSessions(sessionManager.sessions));
  const statusText = $derived(
    mcp.status === "running" ? m.mcp_status_running({ url: endpointUrl(mcp.port) })
    : mcp.status === "starting" ? m.mcp_status_starting()
    : mcp.status === "error" ? (mcp.error ?? m.mcp_status_error())
    : m.mcp_status_off(),
  );

  async function copy(key: string, text: string) {
    if (await copyToClipboard(text)) {
      copied = key;
      setTimeout(() => { if (copied === key) copied = null; }, 1500);
    }
  }

  function commitRedact() {
    mcp.setRedactFields(fieldsFromText(redactText));
    redactText = fieldsToText(mcp.redactFields);
  }

  function commitPort() {
    if (portOk) mcp.setPort(Number(portText));
  }
</script>

<Modal title={m.mcp_title()} width="40rem" ondismiss={onclose}>
  {#snippet body()}
    <div class="mcp">
      <p class="intro">{m.mcp_intro()}</p>

      <div class="row head">
        <label class="switch">
          <input type="checkbox" checked={mcp.enabled} onchange={(e) => mcp.setEnabled(e.currentTarget.checked)} />
          <span>{m.mcp_enable()}</span>
        </label>
        <span class="status" class:on={mcp.status === "running"} class:err={mcp.status === "error"} role="status">
          <span class="dot"></span>{statusText}
        </span>
      </div>

      <div class="grid">
        <label for="mcp-port">{m.mcp_port()}</label>
        <div>
          <input id="mcp-port" class="port" inputmode="numeric" bind:value={portText} onblur={commitPort}
            onkeydown={(e) => { if (e.key === "Enter") { e.stopPropagation(); commitPort(); } }} aria-invalid={!portOk} />
          {#if !portOk}<div class="hint err">{m.mcp_port_invalid()}</div>{/if}
        </div>

        <span>{m.mcp_token()}</span>
        <div>
          <div class="token">
            <code class="tok" aria-label={m.mcp_token()}>{showToken ? mcp.token : "•".repeat(24)}</code>
            <button class="sm" onclick={() => (showToken = !showToken)}>{showToken ? m.mcp_hide() : m.mcp_show()}</button>
            <button class="sm" onclick={() => copy("token", mcp.token)}>{copied === "token" ? m.mcp_copied() : m.mcp_copy()}</button>
            <button class="sm" title={m.mcp_regenerate_hint()} onclick={() => mcp.regenerateToken()}>{m.mcp_regenerate()}</button>
          </div>
        </div>

        <span></span>
        <label class="check">
          <input type="checkbox" checked={mcp.allowWrites} onchange={(e) => mcp.setAllowWrites(e.currentTarget.checked)} />
          <span>{m.mcp_allow_writes()}<span class="hint">{m.mcp_allow_writes_hint()}</span></span>
        </label>

        <label for="mcp-redact">{m.mcp_redact_fields()}</label>
        <div>
          <input id="mcp-redact" class="redact" bind:value={redactText} onblur={commitRedact} spellcheck="false" autocomplete="off"
            onkeydown={(e) => { if (e.key === "Enter") { e.stopPropagation(); commitRedact(); } }} />
          <div class="hint">{m.mcp_redact_fields_hint()}</div>
        </div>

        <span></span>
        <label class="check">
          <input type="checkbox" checked={mcp.auditReads} onchange={(e) => mcp.setAuditReads(e.currentTarget.checked)} />
          <span>{m.mcp_audit_reads()}<span class="hint">{m.mcp_audit_reads_hint()}</span></span>
        </label>
      </div>

      <section>
        <h3>{m.mcp_setup()}</h3>
        <div class="tabs" role="tablist">
          {#each snippets as s (s.id)}
            <button role="tab" aria-selected={client === s.id} class:active={client === s.id} onclick={() => (client = s.id)}>{s.label}</button>
          {/each}
        </div>
        <div class="snippet">
          <pre>{showToken ? snippet.text : snippet.text.replaceAll(mcp.token, "•".repeat(12))}</pre>
          <button class="sm copy" onclick={() => copy(snippet.id, snippet.text)}>{copied === snippet.id ? m.mcp_copied() : m.mcp_copy()}</button>
        </div>
        <div class="hint">{exposed.length ? msgCount("mcp_connections", exposed.length) : m.mcp_no_connections()}</div>
      </section>

      <section>
        <h3>
          {m.mcp_activity()}
          {#if mcp.activity.length}<button class="link" onclick={() => mcp.clearActivity()}>{m.mcp_clear()}</button>{/if}
        </h3>
        {#if mcp.activity.length === 0}
          <div class="hint">{m.mcp_activity_empty()}</div>
        {:else}
          <ul class="activity">
            {#each mcp.activity as a, i (i)}
              <li class:fail={!a.ok} title={a.error ?? undefined}>
                <span class="mono">{a.tool}</span>
                <span class="muted">{a.connection ?? ""}</span>
                <span class="ms">{a.ok ? `${a.ms} ms` : (a.error ?? "")}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>
  {/snippet}
  {#snippet footer()}
    <button class="primary" onclick={onclose}>{m.common_close()}</button>
  {/snippet}
</Modal>

<style>
  .mcp { display: flex; flex-direction: column; gap: 0.875rem; max-height: 70vh; overflow: auto; }
  .intro { margin: 0; color: var(--c-subtext1); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
  .switch, .check { display: flex; align-items: flex-start; gap: 0.5rem; cursor: pointer; }
  .switch { font-weight: 600; align-items: center; }
  .status { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.75rem; color: var(--muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .status .dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--gray-aa); flex: none; }
  .status.on { color: var(--fg); }
  .status.on .dot { background: var(--ok-fg); }
  .status.err { color: var(--error); }
  .status.err .dot { background: var(--error); }
  .grid { display: grid; grid-template-columns: 7rem minmax(0, 1fr); gap: 0.625rem 0.75rem; align-items: center; }
  .grid > label, .grid > span { color: var(--muted); font-size: 0.75rem; }
  .grid .check { color: var(--fg); font-size: var(--fs); }
  .mcp .redact { width: 100% !important; margin-top: 0 !important; font-family: var(--mono); }
  .mcp .port { width: 7rem !important; margin-top: 0 !important; font-family: var(--mono); }
  .token { display: flex; align-items: center; gap: 0.375rem; }
  .tok { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0.3125rem 0.5rem !important; }
  .hint { display: block; font-size: 0.71875rem; color: var(--muted); margin-top: 0.125rem; }
  .hint.err { color: var(--error); }
  .sm { height: 1.625rem; padding: 0 0.5rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--hover); color: var(--fg); font-size: 0.75rem; cursor: pointer; flex: none; }
  .sm:hover { background: var(--menu-hover); }
  section { display: flex; flex-direction: column; gap: 0.375rem; }
  h3 { margin: 0; font-size: 0.71875rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; display: flex; justify-content: space-between; }
  .tabs { display: flex; gap: 0.25rem; flex-wrap: wrap; }
  .tabs button { height: 1.625rem; padding: 0 0.625rem; border: 1px solid var(--border); border-radius: 999px; background: none; color: var(--c-subtext1); font-size: 0.75rem; cursor: pointer; }
  .tabs button.active { border-color: var(--accent); color: var(--fg); background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .snippet { position: relative; }
  pre { margin: 0; padding: 0.625rem 0.75rem; padding-right: 4.5rem; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); font-family: var(--mono); font-size: 0.71875rem; white-space: pre-wrap; word-break: break-all; max-height: 12rem; overflow: auto; }
  .copy { position: absolute; top: 0.375rem; right: 0.375rem; }
  .link { border: none; background: none; padding: 0; color: var(--link); font-size: 0.71875rem; cursor: pointer; text-transform: none; letter-spacing: 0; }
  .activity { list-style: none; margin: 0; padding: 0; max-height: 9rem; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius); }
  .activity li { display: grid; grid-template-columns: 9rem minmax(0, 1fr) auto; gap: 0.5rem; padding: 0.25rem 0.5rem; font-size: 0.75rem; border-bottom: 1px solid var(--row-divider); }
  .activity li:last-child { border-bottom: none; }
  .activity li.fail .ms { color: var(--error); max-width: 16rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mono { font-family: var(--mono); }
  .muted { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ms { color: var(--muted); font-variant-numeric: tabular-nums; }
</style>
