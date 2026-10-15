<!-- GroupForm — $group: group-by fields (or all documents) + named calculations. -->
<script lang="ts">
  import type { GroupModel, GroupOp } from "../../domain/stageForms";
  import type { FieldInfo } from "../../domain/fieldInfo";
  import FieldPicker from "./FieldPicker.svelte";
  import * as m from "#lib/paraglide/messages.js";

  let { value, fields, onchange }: { value: GroupModel; fields: FieldInfo[]; onchange: (v: GroupModel) => void } = $props();

  const OPS: GroupOp[] = ["count", "sum", "avg", "min", "max", "first", "last", "push", "addToSet"];
  const OP_LABEL: Record<GroupOp, () => string> = {
    count: m.builder_op_count, sum: m.builder_op_sum, avg: m.builder_op_avg, min: m.builder_op_min, max: m.builder_op_max,
    first: m.builder_op_first, last: m.builder_op_last, push: m.builder_op_push, addToSet: m.builder_op_addToSet,
  };
  const by = $derived(value.by ?? []);

  function setBy(i: number, path: string) {
    const next = [...by];
    next[i] = path;
    onchange({ ...value, by: next });
  }
  function setAcc(i: number, patch: Partial<GroupModel["accumulators"][number]>) {
    const accs = value.accumulators.map((a, j) => (j === i ? { ...a, ...patch } : a));
    if (patch.op === "count") accs[i] = { name: accs[i].name, op: "count" };
    onchange({ ...value, accumulators: accs });
  }
  function nameFor(op: GroupOp, field?: string) {
    return op === "count" ? "count" : `${op}_${(field ?? "x").split(".").pop()}`;
  }
</script>

<div class="b-form">
  <div class="b-row">
    <span class="b-label">{m.builder_group_by()}</span>
    <label class="b-check"><input type="checkbox" checked={value.by === null} onchange={(e) => onchange({ ...value, by: e.currentTarget.checked ? null : [""] })} /> {m.builder_group_all()}</label>
  </div>
  {#if value.by !== null}
    {#each by as path, i (i)}
      <div class="b-row indent">
        <FieldPicker {fields} value={path} label={`${m.builder_group_by()} ${i + 1}`} onchange={(p) => setBy(i, p)} />
        {#if by.length > 1}<button class="b-x" aria-label={m.builder_remove()} onclick={() => onchange({ ...value, by: by.filter((_, j) => j !== i) })}>×</button>{/if}
      </div>
    {/each}
    <button class="b-link indent" onclick={() => onchange({ ...value, by: [...by, ""] })}>{m.builder_group_add_by()}</button>
  {/if}
  <div class="b-row"><span class="b-label">{m.builder_group_calcs()}</span></div>
  {#each value.accumulators as a, i (i)}
    <div class="b-row indent">
      <select class="b-input" aria-label={`${m.builder_group_calcs()} ${i + 1}`} value={a.op} onchange={(e) => setAcc(i, { op: e.currentTarget.value as GroupOp, field: a.field ?? "" })}>
        {#each OPS as o (o)}<option value={o}>{OP_LABEL[o]()}</option>{/each}
      </select>
      {#if a.op !== "count"}<FieldPicker {fields} value={a.field ?? ""} label={`${OP_LABEL[a.op]()} field`} onchange={(p) => setAcc(i, { field: p })} />{/if}
      <span class="b-muted">{m.builder_as()}</span>
      <input class="b-input mono short" value={a.name} aria-label={`${m.builder_as()} ${i + 1}`} oninput={(e) => setAcc(i, { name: e.currentTarget.value.trim() })} />
      <button class="b-x" aria-label={m.builder_remove()} onclick={() => onchange({ ...value, accumulators: value.accumulators.filter((_, j) => j !== i) })}>×</button>
    </div>
  {/each}
  <button class="b-link indent" onclick={() => onchange({ ...value, accumulators: [...value.accumulators, { name: nameFor("sum", ""), op: "sum", field: "" }] })}>{m.builder_group_add_calc()}</button>
</div>
