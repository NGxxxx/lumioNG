<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import "../app.css";
  import { dev } from "$app/environment";
  import { handleModalKeydown } from "$lib/stores/modalStack";
  let { children } = $props();

  // Hide the webview's native right-click menu in release builds (every surface has its own custom menu); dev keeps it for devtools access.
  function onContextMenu(e: MouseEvent) {
    if (!dev) e.preventDefault();
  }

  // Ctrl/Cmd+A must not "select all" the whole desktop UI; allow it only when an editable field has focus.
  function onKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const editable =
        tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true;
      if (!editable) e.preventDefault();
    }
    handleModalKeydown(e);
  }
</script>

<svelte:window onkeydown={onKeydown} oncontextmenu={onContextMenu} />

{@render children()}
