<!-- SortForm — $sort: ordered fields with direction. -->
<script lang="ts">
  import type { SortModel } from "../../domain/stageForms";
  import type { FieldInfo } from "../../domain/fieldInfo";
  import FieldPicker from "./FieldPicker.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { value, fields, onchange }: { value: SortModel; fields: FieldInfo[]; onchange: (v: SortModel) => void } = $props();
</script>

<div class="b-form">
  {#each value as s, i (i)}
    <div class="b-row">
      <FieldPicker {fields} value={s.field} label={`sort ${i + 1}`} onchange={(p) => onchange(value.map((x, j) => (j === i ? { ...x, field: p } : x)))} />
      <select class="b-input" aria-label={`direction ${i + 1}`} value={String(s.dir)} onchange={(e) => onchange(value.map((x, j) => (j === i ? { ...x, dir: Number(e.currentTarget.value) as 1 | -1 } : x)))}>
        <option value="1">{m.builder_asc()}</option>
        <option value="-1">{m.builder_desc()}</option>
      </select>
      {#if value.length > 1}<button class="b-x" aria-label={m.builder_remove()} onclick={() => onchange(value.filter((_, j) => j !== i))}>×</button>{/if}
    </div>
  {/each}
  <button class="b-link" onclick={() => onchange([...value, { field: "", dir: 1 }])}>{m.builder_sort_add()}</button>
</div>
