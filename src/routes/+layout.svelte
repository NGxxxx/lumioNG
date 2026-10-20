<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import "@fontsource-variable/geist";
  import "@fontsource-variable/geist-mono";
  import "../app.css";
  import { dev } from "$app/env";
  import { handleModalKeydown } from "#lib/stores/modalStack.js";
  import { blocksNativeSelectAll } from "#lib/domain/shortcuts.js";
  import { installErrorLogging } from "#lib/stores/diagnostics.svelte.js";
  import { onMount } from "svelte";
  let { children } = $props();

  // Uncaught errors and unhandled rejections go to the app log file.
  onMount(() => installErrorLogging());

  // Hide the webview's native right-click menu in release builds (every surface has its own custom menu); dev keeps it for devtools access.
  function onContextMenu(e: MouseEvent) {
    if (!dev) e.preventDefault();
  }

  // Ctrl/Cmd+A must not "select all" the whole desktop UI; allow it only when an editable field has focus.
  function onKeydown(e: KeyboardEvent) {
    if (blocksNativeSelectAll(e)) e.preventDefault();
    handleModalKeydown(e);
  }
</script>

<svelte:window onkeydown={onKeydown} oncontextmenu={onContextMenu} />

{@render children()}
