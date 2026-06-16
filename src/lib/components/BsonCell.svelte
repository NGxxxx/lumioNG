<script lang="ts">
  import { describeValue } from "../extjson";

  let { value }: { value: unknown } = $props();

  const info = $derived(describeValue(value));
</script>

<span class="cell {info.type}" title={info.display}>{info.display}</span>

<style>
  .cell { display: inline-block; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
  .objectId, .int, .long, .double, .decimal { font-family: ui-monospace, monospace; }
  .objectId { color: #8a6d3b; }
  .date { color: #31708f; }
  .null { color: #999; font-style: italic; }
  .object, .array { color: #555; font-family: ui-monospace, monospace; }
</style>
