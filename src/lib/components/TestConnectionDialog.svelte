<!-- src/lib/components/TestConnectionDialog.svelte -->
<script lang="ts">
  import Modal from "./Modal.svelte";
  import { createConnectionDiagnosis } from "../stores/connectionDiagnosis.svelte";
  import { describeDiagStep, type DiagStep } from "../domain/connectionDiag";
  import { msgKey } from "#lib/msgkey.js";
  import * as m from "#lib/paraglide/messages.js";

  let {
    result,
    ondiagnose,
    onclose,
  }: {
    result: { ok: true } | { ok: false; kind: "ssh" | "mongo" | "validation"; message: string };
    /** Runs the step-by-step diagnosis; omitted = no Diagnose button. */
    ondiagnose?: () => Promise<DiagStep[]>;
    onclose: () => void;
  } = $props();

  const diagnosis = createConnectionDiagnosis(() => (ondiagnose ? ondiagnose() : Promise.resolve([])));
  const canDiagnose = $derived(!result.ok && result.kind !== "validation" && !!ondiagnose);
</script>

<Modal
  title={m.session_manager_test_result_title()}
  width="26rem"
  ondismiss={onclose}
  onenter={onclose}
>
  {#snippet body()}
    {#if result.ok}
      <p class="ok">{m.session_manager_test_ok()}</p>
    {:else}
      <p class="fail">
        {#if result.kind === "ssh"}
          {m.session_manager_test_fail_ssh({ message: result.message })}
        {:else if result.kind === "mongo"}
          {m.session_manager_test_fail_mongo({ message: result.message })}
        {:else}
          {result.message}
        {/if}
      </p>
    {/if}
    {#if diagnosis.running}
      <p class="muted">{m.diag_running()}</p>
    {:else if diagnosis.error}
      <p class="fail">{diagnosis.error}</p>
    {:else if diagnosis.finished}
      <ol class="steps" aria-label={m.diag_title()}>
        {#each diagnosis.steps as s, i (i)}
          {@const d = describeDiagStep(s)}
          <li class:bad={!s.ok}>
            <span class="mark" aria-hidden="true">{s.ok ? "✓" : "✗"}</span>
            <span class="name">{msgKey(d.labelKey)}</span>
            <span class="ms">{s.ms} ms</span>
            {#if s.ok}
              {#if s.detail}<span class="detail">{s.detail}</span>{/if}
            {:else}
              <span class="detail">{d.friendly ? msgKey(d.friendly.key, d.friendly.params) : d.detail}</span>
              {#if d.friendly && d.detail}<span class="detail raw">{d.detail}</span>{/if}
            {/if}
          </li>
        {/each}
      </ol>
      {#if !diagnosis.verdict}<p class="ok">{m.diag_all_passed()}</p>{/if}
    {/if}
  {/snippet}
  {#snippet footer()}
    {#if canDiagnose}
      <button onclick={diagnosis.start} disabled={diagnosis.running}>{m.diag_button()}</button>
    {/if}
    <button onclick={onclose}>{m.common_ok()}</button>
  {/snippet}
</Modal>

<style>
  p { margin: 0; }
  .ok { color: var(--ok-fg); }
  .fail { color: var(--error); }
  .muted { color: var(--muted); }
  .steps { list-style: none; margin: 0.75rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  li { display: grid; grid-template-columns: 1rem 1fr auto; column-gap: 0.4rem; font-size: 0.85em; }
  li .mark { color: var(--ok-fg); }
  li.bad .mark { color: var(--error); }
  .ms { color: var(--muted); }
  .detail { grid-column: 2 / 4; color: var(--muted); overflow-wrap: anywhere; }
  li.bad .detail:not(.raw) { color: var(--error); }
  .raw { font-family: var(--font-mono, monospace); font-size: 0.9em; }
</style>
