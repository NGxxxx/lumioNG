<script lang="ts">
  import { describeValue } from "../domain/extjson";
  import { jsonValueColor } from "../domain/theme";
  import type { ValueKind } from "../domain/theme";

  let { value }: { value: unknown } = $props();

  const info = $derived(describeValue(value));

  /** Map BsonType → ValueKind for color lookup */
  function toValueKind(type: string): ValueKind | null {
    switch (type) {
      case "string": return "string";
      case "int": case "long": case "double": case "decimal": return "number";
      case "bool": return "bool";
      case "objectId": return "objectid";
      case "date": return "date";
      case "null": return "null";
      default: return null;
    }
  }

  const color = $derived.by(() => {
    const kind = toValueKind(info.type);
    return kind ? jsonValueColor(kind) : null;
  });
</script>

<span
  class="cell {info.type}"
  title={info.display}
  style={color ? `color:${color}` : undefined}
>{info.display}</span>

<style>
  .cell { display: inline-block; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; font-family: ui-monospace, monospace; font-size: 12px; }
  .string { font-family: system-ui, sans-serif; }
  .null { font-style: italic; }
  .object { color: #8a6cb5; font-style: italic; font-size: 11px; font-family: ui-monospace, monospace; }
  .array { color: #a07b2f; font-style: italic; font-size: 11px; font-family: ui-monospace, monospace; }
</style>
