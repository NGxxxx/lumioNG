<!-- FieldPicker — a field-path input with suggestions (type + presence) for builder forms. -->
<script lang="ts">
  import type { FieldInfo } from "../../domain/fieldInfo";

  let { fields, value, onchange, label, placeholder = "field" }: {
    fields: FieldInfo[];
    value: string;
    onchange: (path: string) => void;
    label: string;
    placeholder?: string;
  } = $props();

  const listId = `fp-${Math.random().toString(36).slice(2, 9)}`;
</script>

<input class="b-input mono" list={listId} {value} {placeholder} aria-label={label} spellcheck="false" autocomplete="off"
  oninput={(e) => onchange(e.currentTarget.value.trim())} />
<datalist id={listId}>
  {#each fields as f (f.path)}<option value={f.path}>{f.type}{f.presence !== null ? ` · ${Math.round(f.presence * 100)}%` : ""}</option>{/each}
</datalist>
