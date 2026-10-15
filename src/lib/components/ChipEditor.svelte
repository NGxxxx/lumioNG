<!-- src/lib/components/ChipEditor.svelte — popover to add or edit one filter condition: field → operator → typed value(s). Rendering + input glue; conversions live in domain/chipText. -->
<script lang="ts">
  import { untrack } from "svelte";
  import { opsForType, type Chip, type ChipOp } from "../domain/filterChips";
  import type { FieldInfo, ChipValueType } from "../domain/fieldInfo";
  import { valueTextFor, editValue, valueCountFor } from "../domain/chipText";
  import { chipOpLabel } from "./chipOpLabel";
  import * as m from "#lib/paraglide/messages.js";

  let {
    fields,
    valuesFor,
    initial = null,
    onsave,
    oncancel,
  }: {
    fields: FieldInfo[];
    /** Distinct values (JSON text) seen for a field; [] when unknown / too many. */
    valuesFor: (path: string) => string[];
    initial?: Chip | null;
    onsave: (chip: Chip) => void;
    oncancel: () => void;
  } = $props();

  // A slot keeps the exact original JSON text until the user edits it (so editing the operator of
  // `n = 9007199254740993` never re-serializes the number).
  type Slot = { raw: string; text: string | null };
  const init = untrack(() => initial);
  let field = $state(init?.field ?? "");
  let op = $state<ChipOp | null>(init?.op ?? null);
  let slots = $state<Slot[]>(init ? init.values.map((t) => ({ raw: editValue(t), text: t })) : []);
  // The list is edited as text; untouched it saves the original values (so a string with a comma,
  // or `"5"` on an untyped field, is never re-parsed), and kept tokens map back to their original text.
  const initList = init?.op === "in" ? init.values.map(editValue).join(", ") : "";
  let listRaw = $state(initList);
  let error = $state<string | null>(null);
  let fieldOpen = $state(!init);

  const info = $derived(fields.find((f) => f.path === field) ?? null);
  const type = $derived<ChipValueType>(info?.type ?? "unknown");
  const ops = $derived(opsForType(type));
  const count = $derived(op ? valueCountFor(op) : 0);
  const suggestions = $derived(
    fields.filter((f) => f.path.toLowerCase().includes(field.trim().toLowerCase())).slice(0, 12),
  );
  const known = $derived(field ? valuesFor(field) : []);
  // A native date picker only while every value is a bare day — a timed value stays editable as text.
  const inputType = $derived(
    op === "lastDays" || op === "size" ? "number"
    : type === "date" && op !== "eq" && op !== "ne" && slots.every((s) => !s?.raw || /^\d{4}-\d{2}-\d{2}$/.test(s.raw)) ? "date"
    : "text",
  );
  const knownText = (p: string) => [...(init?.values ?? []), ...valuesFor(field.trim())].find((t) => editValue(t) === p);

  function pickField(f: FieldInfo) {
    field = f.path;
    fieldOpen = false;
    if (!op || !opsForType(f.type).includes(op)) op = opsForType(f.type)[0];
    error = null;
  }

  function setSlot(i: number, raw: string) {
    const next = [...slots];
    next[i] = { raw, text: null };
    slots = next;
    error = null;
  }

  function slotText(s: Slot | undefined, i: number): string | null {
    if (!s) return null;
    if (s.text !== null) return s.text;
    if (op === "lastDays" || op === "size") return /^\d+$/.test(s.raw.trim()) ? s.raw.trim() : null;
    if (op === "contains" || op === "startsWith") return s.raw.trim() ? JSON.stringify(s.raw.trim()) : null;
    // The end of a date range covers that whole day.
    return knownText(s.raw) ?? valueTextFor(type, s.raw, { endOfDay: op === "between" && i === 1 });
  }

  function save() {
    const f = field.trim();
    if (!f || !op) return;
    let values: string[] = [];
    if (count === "many") {
      const untouched = init?.op === "in" && listRaw === initList;
      const texts = untouched
        ? init.values
        : listRaw.split(",").map((p) => p.trim()).filter(Boolean).map((p) => knownText(p) ?? valueTextFor(type, p));
      if (texts.length === 0 || texts.some((t) => t === null)) return void (error = m.chips_invalid_value());
      values = texts as string[];
    } else if (count !== 0) {
      const texts = Array.from({ length: count }, (_, i) => slotText(slots[i], i));
      if (texts.some((t) => t === null)) return void (error = m.chips_invalid_value());
      values = texts as string[];
    }
    // An untouched `$lt` range end stays exclusive (never silently widened to `$lte`).
    const keepExclusive = op === "between" && init?.op === "between" && init.upperExclusive && slots[1]?.text !== null;
    onsave(keepExclusive ? { field: f, op, values, upperExclusive: true } : { field: f, op, values });
  }

  function onkey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      oncancel();
    } else if (e.key === "Enter" && !fieldOpen) {
      e.preventDefault();
      save();
    }
  }

  function quickDays(n: number) {
    op = "lastDays";
    slots = [{ raw: String(n), text: null }];
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="editor" role="dialog" tabindex="-1" aria-label={m.chips_add()} onkeydown={onkey}>
  <label class="fld">
    <span>{m.chips_field()}</span>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      value={field}
      autofocus={!init}
      autocomplete="off"
      spellcheck="false"
      oninput={(e) => { field = e.currentTarget.value; fieldOpen = true; }}
      onfocus={() => (fieldOpen = true)}
      onkeydown={(e) => {
        if (e.key === "Enter" && fieldOpen) {
          e.preventDefault();
          const exact = fields.find((f) => f.path === field.trim());
          if (exact) pickField(exact);
          else if (suggestions[0]) pickField(suggestions[0]);
          else { fieldOpen = false; op = op ?? opsForType("unknown")[0]; }
        }
      }}
    />
    {#if fieldOpen && suggestions.length}
      <ul class="sugg" role="listbox">
        {#each suggestions as f (f.path)}
          <li role="option" aria-selected={f.path === field}>
            <button type="button" onmousedown={(e) => { e.preventDefault(); pickField(f); }}>
              <span class="path">{f.path}</span>
              <span class="meta">{f.type}{f.presence !== null ? ` · ${m.chips_presence({ pct: String(Math.round(f.presence * 100)) })}` : ""}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </label>

  {#if field && !fieldOpen}
    <label class="fld">
      <span>{m.chips_operator()}</span>
      <select value={op} onchange={(e) => { op = e.currentTarget.value as ChipOp; error = null; }}>
        {#each ops as o (o)}<option value={o}>{chipOpLabel(o, type)}</option>{/each}
      </select>
    </label>

    {#if count === "many"}
      <label class="fld grow">
        <span>{m.chips_value()} <em>({m.chips_values_hint()})</em></span>
        <input bind:value={listRaw} list="chip-values" autocomplete="off" />
      </label>
    {:else if count !== 0}
      {#each Array.from({ length: count }) as _, i (i)}
        <label class="fld grow">
          <span>{i === 0 ? m.chips_value() : m.chips_value_to()}</span>
          <input
            type={inputType}
            value={slots[i]?.raw ?? ""}
            list={inputType === "text" ? "chip-values" : undefined}
            autocomplete="off"
            oninput={(e) => setSlot(i, e.currentTarget.value)}
          />
        </label>
      {/each}
      {#if type === "date"}
        <span class="quick">
          <button type="button" onclick={() => quickDays(7)}>{m.chips_last_7()}</button>
          <button type="button" onclick={() => quickDays(30)}>{m.chips_last_30()}</button>
        </span>
      {/if}
    {/if}
    <datalist id="chip-values">
      {#each known as t (t)}<option value={editValue(t)}></option>{/each}
    </datalist>
  {/if}

  <div class="actions">
    {#if error}<span class="err">{error}</span>{/if}
    <button type="button" onclick={oncancel}>{m.chips_cancel()}</button>
    <button type="button" class="primary" disabled={!field || fieldOpen || !op} onclick={save}>{m.chips_apply()}</button>
  </div>
</div>

<style>
  .editor {
    position: absolute; top: calc(100% + 0.375rem); left: 0; z-index: 40; width: min(34rem, 92vw);
    display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.5rem; padding: 0.625rem;
    border: 1px solid var(--c-surface1); border-radius: var(--radius-lg); background: var(--popover); box-shadow: var(--shadow-sm);
  }
  .fld { position: relative; display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.6875rem; color: var(--muted); }
  .fld.grow { flex: 1 1 8rem; }
  .fld em { font-style: normal; opacity: 0.8; }
  .fld input, .fld select {
    height: 1.75rem; padding: 0 0.5rem; border: 1px solid var(--c-surface1); border-radius: var(--radius);
    background: var(--bg); color: var(--fg); font-size: var(--fs); font-family: var(--mono); min-width: 9rem;
  }
  .fld input:focus, .fld select:focus { outline: none; border-color: var(--accent); }
  .sugg {
    position: absolute; top: 100%; left: 0; z-index: 41; margin: 0.25rem 0 0; padding: 0.25rem; list-style: none;
    min-width: 16rem; max-height: 14rem; overflow: auto; border: 1px solid var(--c-surface1);
    border-radius: var(--radius); background: var(--popover); box-shadow: var(--shadow-sm);
  }
  .sugg button {
    display: flex; justify-content: space-between; gap: 0.75rem; width: 100%; padding: 0.25rem 0.375rem;
    border: none; border-radius: var(--radius-sm); background: none; color: var(--fg); cursor: pointer; text-align: left;
  }
  .sugg button:hover { background: var(--menu-hover); }
  .path { font-family: var(--mono); font-size: 0.75rem; }
  .meta { color: var(--muted); font-size: 0.6875rem; white-space: nowrap; }
  .quick { display: flex; gap: 0.25rem; }
  .quick button, .actions button {
    height: 1.75rem; padding: 0 0.625rem; border: 1px solid var(--c-surface1); border-radius: var(--radius);
    background: var(--panel); color: var(--fg); font-size: 0.75rem; cursor: pointer;
  }
  .actions { display: flex; align-items: center; gap: 0.375rem; margin-left: auto; }
  .actions .primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .actions .primary:disabled { opacity: 0.5; cursor: default; }
  .err { color: var(--error); font-size: 0.75rem; }
</style>
