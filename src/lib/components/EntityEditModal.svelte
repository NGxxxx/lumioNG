<script lang="ts">
  import type { Snippet } from "svelte";
  import { msgKey } from "#lib/msgkey.js";
  import Modal from "./Modal.svelte";
  import * as m from "#lib/paraglide/messages.js";

  // Cancel/Save shell shared by the admin entity editors (edit role, edit user roles, change
  // password): the caller supplies the fields, this adds the busy/error handling and footer.
  // Enter is deliberately NOT wired to Save — these dialogs embed CodeEditor, where Enter is a newline.
  let {
    title,
    ariaLabel,
    error = null,
    busy = false,
    onCancel,
    onSave,
    fields,
  }: {
    title: string;
    ariaLabel: string;
    error?: string | null;
    busy?: boolean;
    onCancel: () => void;
    onSave: () => void;
    fields: Snippet;
  } = $props();
</script>

<Modal {title} label={ariaLabel} ondismiss={onCancel}>
  {#snippet body()}
    <div class="fields">
      {@render fields()}
      {#if error}<div class="dlg-error">{msgKey(error)}</div>{/if}
    </div>
  {/snippet}
  {#snippet footer()}
    <button onclick={onCancel}>{m.common_cancel()}</button>
    <button class="primary" disabled={busy} onclick={onSave}>{m.common_save()}</button>
  {/snippet}
</Modal>

<style>
  /* :global — the fields are markup passed in by the caller. */
  .fields :global(label) { display: block; }
</style>
