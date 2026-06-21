<script lang="ts">
  import type { Doc } from "../domain/columns";
  import { describeValue } from "../domain/extjson";
  import { jsonValueColor, type ValueKind } from "../domain/theme";
  import { toJsonDoc } from "../domain/exporter";
  async function copyDoc(doc: Doc) {
    try { await navigator.clipboard.writeText(toJsonDoc(doc)); } catch { /* ignore */ }
  }

  let { docs }: { docs: Doc[] } = $props();
  let open = $state<Record<number, boolean>>({});
  const toggle = (i: number) => (open = { ...open, [i]: !open[i] });

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
  function valColor(v: unknown): string {
    const info = describeValue(v);
    const kind = toValueKind(info.type);
    if (kind) return `color:${jsonValueColor(kind)}`;
    if (info.type === "object") return "color:#7b53b8";
    if (info.type === "array") return "color:#a07b2f";
    return "color:#444";
  }
</script>

{#if docs.length === 0}
  <div class="empty">No results</div>
{:else}
  <div class="tree-scroller">
    {#each docs as doc, i (i)}
      {@const isOpen = !!open[i]}
      <div class="tree-doc">
        <div class="tree-header" role="button" tabindex="0"
          onclick={() => toggle(i)}
          onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(i); } }}>
          <span class="tree-n">{i + 1}</span>
          <span class="tree-brace">{"{"}{isOpen ? "" : " … }"}</span>
          <button class="tree-copy" title="Copy document as JSON"
            onclick={(e) => { e.stopPropagation(); copyDoc(doc); }}>Copy</button>
        </div>
        {#if isOpen}
          <div class="tree-body">
            {#each Object.entries(doc) as [key, val] (key)}
              <div class="tree-line">
                <span class="tree-key">{key}</span><span class="tree-colon">:</span>
                <span class="tree-val" style={valColor(val)}>{describeValue(val).display}</span>
              </div>
            {/each}
            <div class="tree-close">{"}"}</div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .empty { padding: 16px; color: var(--muted); font-size: 12px; }
  .tree-scroller { overflow: auto; height: 100%; background: #fff; font-family: Consolas, monospace; font-size: 12.5px; line-height: 1.55; padding: 8px 0; }
  .tree-doc { border-bottom: 1px solid #f0f0f0; padding: 2px 0; }
  .tree-header { display: flex; align-items: center; gap: 8px; padding: 1px 10px; cursor: default; user-select: none; }
  .tree-header:hover { background: #f5f9fd; }
  .tree-n { color: #999; }
  .tree-brace { color: #7b53b8; }
  .tree-body { padding: 1px 0 4px 0; }
  .tree-line { padding: 0 10px 0 26px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tree-key { color: #9a2f8f; }
  .tree-colon { color: #555; }
  .tree-val { margin-left: 5px; }
  .tree-close { padding: 1px 10px 1px 22px; color: #7b53b8; }
  .tree-copy { margin-left: auto; height: 18px; padding: 0 8px; font-size: 11px; border: 1px solid #ccc; border-radius: 2px; background: #f0f0f0; color: #444; cursor: pointer; opacity: 0; }
  .tree-header:hover .tree-copy { opacity: 1; }
</style>
