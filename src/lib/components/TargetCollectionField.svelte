<script lang="ts">
  import SuggestInput from "./SuggestInput.svelte";
  import * as m from "$lib/paraglide/messages";
  import { msgKey } from "$lib/msgkey";

  let {
    value,
    existingCollections,
    onInput,
    errorKey = null,
    notice = null,
    placeholder = "",
    id = "import-target-collections",
  }: {
    value: string;
    existingCollections: string[];
    onInput: (v: string) => void;
    errorKey?: string | null;
    notice?: string | null;
    placeholder?: string;
    id?: string;
  } = $props();

  const inputId = $derived(`${id}-input`);
  const suggestions = $derived(existingCollections.map((name) => ({ label: name })));
</script>

<div class="field-row">
  <label class="label" for={inputId}>{m.import_dialog_target_collection_label()}</label>
  <SuggestInput id={inputId} class="target-input" {value} {onInput} {placeholder} {suggestions} />
</div>
{#if errorKey}<div class="error">{msgKey(errorKey)}</div>{/if}
{#if notice}<div class="notice">{notice}</div>{/if}

<style>
  .field-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.625rem; }
  .label { color: var(--gray-77); flex: none; }
  /* :global — this class now lives on an <input> rendered inside SuggestInput.svelte, a different
     component, so Svelte's per-component CSS scoping needs an explicit escape hatch to reach it. */
  :global(.target-input) {
    flex: 1;
    min-width: 0;
    height: 1.5rem;
    box-sizing: border-box;
  }
  .notice { background: var(--blue-tint5); color: var(--slate); padding: 0.375rem 0.625rem; border-radius: var(--radius); font-size: var(--fs); margin-bottom: 0.75rem; }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; font-size: var(--fs); margin-top: 0.625rem; margin-bottom: 0.625rem; border-radius: var(--radius); }
</style>
