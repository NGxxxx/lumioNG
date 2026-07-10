<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import "../app.css";
  let { children } = $props();

  // Ctrl/Cmd+A must not "select all" the whole desktop UI; allow it only when an editable field has focus.
  function onKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const editable =
        tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true;
      if (!editable) e.preventDefault();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{@render children()}
