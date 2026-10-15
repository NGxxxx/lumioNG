<!-- ProjectForm — $project / $addFields / $set: per field keep / drop / rename / compute. -->
<script lang="ts">
  import type { ProjectModel } from "../../domain/stageForms";
  import type { FieldInfo } from "../../domain/fieldInfo";
  import FieldPicker from "./FieldPicker.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { value, fields, onchange, allowKeepDrop }: { value: ProjectModel; fields: FieldInfo[]; onchange: (v: ProjectModel) => void; allowKeepDrop: boolean } = $props();
  type Mode = ProjectModel[number]["mode"];
  const modes = $derived<Mode[]>(allowKeepDrop ? ["include", "exclude", "rename", "expr"] : ["rename", "expr"]);
  const LABEL: Record<Mode, () => string> = { include: m.builder_mode_include, exclude: m.builder_mode_exclude, rename: m.builder_mode_rename, expr: m.builder_mode_expr };
  const set = (i: number, patch: Partial<ProjectModel[number]>) => onchange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
</script>

<div class="b-form">
  {#each value as p, i (i)}
    <div class="b-row">
      <FieldPicker {fields} value={p.field} label={`field ${i + 1}`} onchange={(f) => set(i, { field: f })} />
      <select class="b-input" aria-label={`mode ${i + 1}`} value={p.mode} onchange={(e) => set(i, { mode: e.currentTarget.value as Mode, value: e.currentTarget.value === "rename" || e.currentTarget.value === "expr" ? (p.value ?? "") : undefined })}>
        {#each modes as md (md)}<option value={md}>{LABEL[md]()}</option>{/each}
      </select>
      {#if p.mode === "rename"}
        <FieldPicker {fields} value={p.value ?? ""} label={`${LABEL.rename()} ${i + 1}`} onchange={(f) => set(i, { value: f })} />
      {:else if p.mode === "expr"}
        <input class="b-input mono grow" value={p.value ?? ""} placeholder={'{ "$add": ["$a", 1] }'} aria-label={`${LABEL.expr()} ${i + 1}`} oninput={(e) => set(i, { value: e.currentTarget.value })} />
      {/if}
      <button class="b-x" aria-label={m.builder_remove()} onclick={() => onchange(value.filter((_, j) => j !== i))}>×</button>
    </div>
  {/each}
  <button class="b-link" onclick={() => onchange([...value, { field: "", mode: allowKeepDrop ? "include" : "expr", value: allowKeepDrop ? undefined : "" }])}>{m.builder_project_add()}</button>
</div>
