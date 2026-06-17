<script lang="ts">
  import TreeNode from "./TreeNode.svelte";
  import type { Doc } from "../columns";

  let {
    value,
    onchange,
    onvalidchange,
  }: {
    value: Doc;
    onchange: (v: Doc) => void;
    onvalidchange: (valid: boolean) => void;
  } = $props();

  let errorPaths = $state(new Set<string>());

  function setError(path: string, hasError: boolean) {
    const next = new Set(errorPaths);
    if (hasError) next.add(path);
    else next.delete(path);
    errorPaths = next;
    onvalidchange(next.size === 0);
  }
</script>

<div class="tree-editor">
  <TreeNode
    root
    label=""
    value={value}
    path=""
    removable={false}
    lockedKeys={["_id"]}
    onchange={(v) => onchange(v as Doc)}
    onremove={() => {}}
    onerror={setError}
  />
</div>

<style>
  .tree-editor { padding: 8px 12px; overflow: auto; flex: 1; min-height: 0; }
</style>
