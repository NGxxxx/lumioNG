<!-- AuditLogView — write-operation audit log: which environments are audited, filter by period / environment / connection, integrity check, export. State lives in stores/audit. -->
<script lang="ts">
  import Modal from "./Modal.svelte";
  import { audit } from "../stores/audit.svelte";
  import { toast } from "../stores/toast.svelte";
  import { pickSavePath } from "../stores/desktop";
  import { errorMessage } from "../api/errors";
  import {
    AUDIT_RANGES, AUDIT_SCOPES, connectionLabels, filterByConnection, filterText,
    type AuditRange, type AuditScope,
  } from "../domain/audit";
  import * as m from "#lib/paraglide/messages.js";

  let { onclose }: { onclose: () => void } = $props();

  let range = $state<AuditRange>("7d");
  let environment = $state("");
  let connection = $state("");

  const rows = $derived(filterByConnection(audit.entries, connection));
  const labels = $derived(connectionLabels(audit.entries));

  const scopeLabel: Record<AuditScope, () => string> = {
    prod: m.audit_scope_prod,
    staging_prod: m.audit_scope_staging_prod,
    all: m.audit_scope_all,
  };
  const rangeLabel: Record<AuditRange, () => string> = {
    "24h": m.audit_range_24h,
    "7d": m.audit_range_7d,
    "30d": m.audit_range_30d,
    all: m.audit_range_all,
  };

  function reload() {
    void audit.load(range, environment);
  }
  reload();

  async function exportLog() {
    const path = await pickSavePath("lumio-audit.jsonl", "jsonl");
    if (!path) return;
    try {
      toast.push(m.audit_exported({ count: String(await audit.exportTo(path)) }), "success");
    } catch (e) {
      toast.push(m.audit_export_failed({ error: errorMessage(e) }), "error");
    }
  }

  const time = (ts: number) => new Date(ts).toLocaleString();
</script>

<Modal title={m.audit_title()} width="64rem" ondismiss={onclose}>
  {#snippet body()}
    <div class="audit">
      <p class="intro">{m.audit_intro()}</p>

      <div class="bar">
        <label>
          <span>{m.audit_scope()}</span>
          <select aria-label={m.audit_scope()} value={audit.scope} onchange={(e) => audit.setScope(e.currentTarget.value as AuditScope)}>
            {#each AUDIT_SCOPES as s (s)}<option value={s}>{scopeLabel[s]()}</option>{/each}
          </select>
        </label>
      </div>

      <div class="bar">
        <label>
          <span>{m.audit_range()}</span>
          <select aria-label={m.audit_range()} bind:value={range} onchange={reload}>
            {#each AUDIT_RANGES as r (r)}<option value={r}>{rangeLabel[r]()}</option>{/each}
          </select>
        </label>
        <label>
          <span>{m.audit_environment()}</span>
          <select aria-label={m.audit_environment()} bind:value={environment} onchange={reload}>
            <option value="">{m.audit_env_any()}</option>
            <option value="prod">PROD</option>
            <option value="staging">STG</option>
            <option value="dev">DEV</option>
          </select>
        </label>
        <label>
          <span>{m.audit_connection()}</span>
          <select aria-label={m.audit_connection()} bind:value={connection}>
            <option value="">{m.audit_connection_any()}</option>
            {#each labels as l (l)}<option value={l}>{l}</option>{/each}
          </select>
        </label>
        <button onclick={reload}>{m.audit_refresh()}</button>
        <button onclick={() => void audit.verify()}>{m.audit_verify()}</button>
        <button onclick={() => void exportLog()}>{m.audit_export()}</button>
      </div>

      {#if audit.report}
        <div class="verify" class:bad={!audit.report.ok} role="status">
          {#if audit.report.ok}
            {m.audit_verify_ok({ lines: String(audit.report.lines), files: String(audit.report.files) })}
          {:else}
            {m.audit_verify_broken({ file: audit.report.brokenFile ?? "", line: String(audit.report.brokenLine ?? 0) })}
          {/if}
        </div>
      {/if}
      {#if audit.report?.torn?.length}
        <div class="verify" role="status">{m.audit_verify_torn({ count: String(audit.report.torn.length) })}</div>
      {/if}
      {#if audit.error}<div class="verify bad" role="alert">{audit.error}</div>{/if}

      <div class="table">
        {#if audit.loading}
          <div class="hint">{m.audit_loading()}</div>
        {:else if rows.length === 0}
          <div class="hint">{m.audit_empty()}</div>
        {:else}
          <table>
            <thead>
              <tr>
                <th>{m.audit_col_time()}</th><th>{m.audit_col_user()}</th><th>{m.audit_col_connection()}</th>
                <th>{m.audit_col_op()}</th><th>{m.audit_col_ns()}</th><th>{m.audit_col_filter()}</th>
                <th>{m.audit_col_count()}</th><th>{m.audit_col_result()}</th><th>{m.audit_col_source()}</th>
              </tr>
            </thead>
            <tbody>
              {#each rows as e, i (i)}
                <tr class:fail={!e.ok}>
                  <td class="nowrap">{time(e.ts)}</td>
                  <td>{e.os_user}</td>
                  <td>{e.session_label} <span class="env">{e.environment}</span></td>
                  <td class="mono">{e.op}</td>
                  <td class="mono">{e.ns}</td>
                  <td class="mono filter" title={filterText(e.filter_redacted)}>{filterText(e.filter_redacted)}</td>
                  <td class="num">{e.count ?? ""}</td>
                  <td title={e.error ?? undefined}>{e.ok ? m.audit_result_ok() : m.audit_result_failed()}</td>
                  <td>{e.source}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </div>
  {/snippet}
  {#snippet footer()}
    <button class="primary" onclick={onclose}>{m.common_close()}</button>
  {/snippet}
</Modal>

<style>
  .audit { display: flex; flex-direction: column; gap: 0.75rem; max-height: 72vh; }
  .intro { margin: 0; color: var(--c-subtext1); }
  .bar { display: flex; gap: 0.75rem; align-items: flex-end; flex-wrap: wrap; }
  .bar label { display: flex; flex-direction: column; gap: 0.125rem; font-size: 0.75rem; color: var(--muted); }
  .bar select, .bar button { height: 1.75rem; }
  .verify { padding: 0.375rem 0.625rem; border: 1px solid var(--border); border-radius: var(--radius); font-size: 0.75rem; }
  .verify.bad { color: var(--error); border-color: var(--error); }
  .table { overflow: auto; border: 1px solid var(--border); border-radius: var(--radius); min-height: 6rem; }
  .hint { padding: 1rem; color: var(--muted); font-size: 0.8125rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
  th { position: sticky; top: 0; background: var(--bg); text-align: left; padding: 0.3125rem 0.5rem; color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--border); }
  td { padding: 0.25rem 0.5rem; border-bottom: 1px solid var(--row-divider); vertical-align: top; }
  tr.fail td { color: var(--error); }
  .mono { font-family: var(--mono); }
  .nowrap { white-space: nowrap; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .env { color: var(--muted); text-transform: uppercase; font-size: 0.6875rem; }
  .filter { max-width: 14rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
