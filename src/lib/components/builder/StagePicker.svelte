<!-- StagePicker — the stage operator <select>, grouped by what each stage is for. -->
<script lang="ts">
  import { PIPELINE_STAGES } from "../../domain/mongoOps";
  import { STAGE_CATEGORIES, type StageCategory } from "../../domain/stageForms";
  import * as m from "#lib/paraglide/messages.js";

  let { value, onchange }: { value: string; onchange: (name: string) => void } = $props();

  const CATEGORY_LABEL: Record<StageCategory, () => string> = {
    filter: m.builder_cat_filter,
    reshape: m.builder_cat_reshape,
    group: m.builder_cat_group,
    join: m.builder_cat_join,
    output: m.builder_cat_output,
  };
  const detail = (name: string) => PIPELINE_STAGES.find((s) => s.label === name)?.detail ?? "";
</script>

<select class="b-input" aria-label={m.pipeline_tree_stage_picker_label()} {value} onchange={(e) => onchange(e.currentTarget.value)}>
  {#each STAGE_CATEGORIES as c (c.key)}
    <optgroup label={CATEGORY_LABEL[c.key]()}>
      {#each c.stages as s (s)}<option value={s} title={detail(s)}>{s} — {detail(s)}</option>{/each}
    </optgroup>
  {/each}
</select>
