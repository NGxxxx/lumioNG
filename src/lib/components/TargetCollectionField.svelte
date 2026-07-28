<script lang="ts">
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
</script>

<div class="field-row">
  <label class="label" for={inputId}>{m.import_dialog_target_collection_label()}</label>
  <input
    id={inputId}
    class="target-input"
    list={id}
    {placeholder}
    {value}
    oninput={(e) => onInput(e.currentTarget.value)}
  />
</div>
<datalist {id}>
  {#each existingCollections as name (name)}<option value={name}></option>{/each}
</datalist>
{#if errorKey}<div class="error">{msgKey(errorKey)}</div>{/if}
{#if notice}<div class="notice">{notice}</div>{/if}

<style>
  .field-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.625rem; }
  .label { color: var(--gray-77); flex: none; }
  .target-input {
    flex: 1;
    min-width: 0;
    height: 1.5rem;
    padding: 0 0.5rem;
    box-sizing: border-box;
    border: 1px solid var(--gray-b8);
    border-radius: 0.1875rem;
    background: var(--panel);
    color: var(--fg);
    font-size: var(--fs);
  }
  .target-input:focus { outline: none; border-color: var(--focus-ring); }
  .notice { background: var(--blue-tint5); color: var(--slate); padding: 0.375rem 0.625rem; border-radius: 0.1875rem; font-size: var(--fs); margin-bottom: 0.75rem; }
  .error { background: var(--error-bg); color: var(--error); padding: 0.375rem 0.625rem; font-size: var(--fs); margin-top: 0.625rem; margin-bottom: 0.625rem; border-radius: 0.1875rem; }
</style>
