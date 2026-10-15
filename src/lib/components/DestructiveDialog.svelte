<!-- src/lib/components/DestructiveDialog.svelte — confirmation for a destructive operation: real count, irreversibility, optional type-to-confirm. Content comes from domain/confirmPolicy.describeDestructive. -->
<script lang="ts">
  import Modal from "./Modal.svelte";
  import type { DestructiveGate } from "../stores/destructiveGate.svelte";
  import { describeDestructive } from "../domain/confirmPolicy";
  import { formatBytes } from "../domain/stats";
  import { msgKey, msgCount } from "#lib/msgkey.js";
  import * as m from "#lib/paraglide/messages.js";

  let { gate }: { gate: DestructiveGate } = $props();

  let typed = $state("");
  // A new request never inherits what was typed for the previous one.
  $effect(() => {
    void gate.seq;
    typed = "";
  });
  const p = $derived(gate.pending);
  const d = $derived(p ? describeDestructive(p.op, p.target, p.count, p.level, p.undoable) : null);
  const target = $derived(p ? (p.target.coll ? m.destructive_target_coll({ db: p.target.db, coll: p.target.coll }) : p.target.db) : "");
  const ready = $derived(!!p && !p.counting && !gate.running && (d?.expectedName == null || typed === d.expectedName));

  const COUNTED = new Set(["deleteMany", "updateMany", "truncate"]);
  const action = $derived.by(() => {
    if (!p || !d) return "";
    if (COUNTED.has(p.op)) return p.count !== null ? msgCount(d.actionKey, p.count) : msgKey(d.titleKey);
    return msgKey(d.actionKey);
  });

  const countLine = $derived.by(() => {
    if (!p || !d) return null;
    if (p.counting) return m.destructive_counting();
    if (p.countFailed) return m.destructive_count_failed();
    if (d.countText === null) return null;
    switch (p.op) {
      case "deleteMany":
      case "updateMany":
        return msgCount("destructive_count_match", p.count!, { target });
      case "dropCollection":
      case "truncate":
        if ((p.target.colls?.length ?? 0) > 1) return msgCount("destructive_count_total", p.count!);
        return msgCount("destructive_count_coll", p.count!, { target, size: formatBytes(p.bytes) });
      case "dropDatabase":
        return m.destructive_count_db({ db: p.target.db, collections: String(p.collections ?? "?"), count: d.countText });
      default:
        return null;
    }
  });

  function submit() {
    if (ready) void gate.confirm();
  }
</script>

{#if p && d}
  <Modal title={msgKey(d.titleKey)} ondismiss={() => gate.cancel()} onenter={submit} enterDisabled={() => !ready}>
    {#snippet body()}
      <div class="dd">
        {#if (p.target.colls?.length ?? 0) > 1}
          <p class="mono">{m.destructive_colls_line({ count: String(p.target.colls!.length), names: p.target.colls!.join(", ") })}</p>
        {/if}
        {#if p.op === "dropIndex" && p.target.index}
          <p>{m.destructive_index_line({ index: p.target.index, target })}</p>
        {:else if p.target.detail}
          <p class="mono">{p.target.detail}</p>
        {/if}
        {#if countLine}<p class="count" class:muted={p.counting} class:warn={p.countFailed}>{countLine}</p>{/if}
        {#if p.env === "prod"}<p class="prod">{m.destructive_on_prod()}</p>{/if}
        {#if d.irreversible}<p class="irrev">{m.destructive_irreversible()}</p>{/if}
        {#if d.expectedName !== null}
          <label class="type">
            <span>{m.destructive_type_prompt({ name: d.expectedName })}</span>
            <!-- svelte-ignore a11y_autofocus -->
            <input bind:value={typed} disabled={gate.running} autofocus autocomplete="off" spellcheck="false" />
          </label>
        {/if}
        {#if gate.error}<div class="dlg-error">{gate.error}</div>{/if}
      </div>
    {/snippet}
    {#snippet footer()}
      <button onclick={() => gate.cancel()} disabled={gate.running}>{m.common_cancel()}</button>
      <button class="danger" disabled={!ready} onclick={submit}>
        {#if gate.running}<span class="dlg-spinner" aria-hidden="true"></span>{m.common_running()}{:else}{action}{/if}
      </button>
    {/snippet}
  </Modal>
{/if}

<style>
  .dd { display: flex; flex-direction: column; gap: 0.5rem; }
  .dd p { margin: 0; word-break: break-word; }
  .mono { font-family: var(--mono); font-size: 0.75rem; color: var(--muted); }
  .count { font-weight: 500; }
  .count.muted { color: var(--muted); font-weight: 400; }
  .count.warn { color: var(--warn-fg); }
  .prod { color: var(--danger); font-weight: 500; }
  .irrev { color: var(--muted); }
  .type { display: flex; flex-direction: column; gap: 0.375rem; margin-top: 0.25rem; }
  .type span { color: var(--muted); font-size: 0.75rem; }
  .type input { font-family: var(--mono); }
</style>
