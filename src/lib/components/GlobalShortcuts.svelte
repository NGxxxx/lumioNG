<script lang="ts">
  import { SHORTCUTS, type Command, type CommandId } from "#lib/domain/commands.js";
  import { matchesEvent, isDefaultWebviewAccelerator, isTypingTarget, type Platform } from "#lib/domain/shortcuts.js";
  import { isModalOpen } from "#lib/stores/modalStack.js";

  let {
    commands,
    plat,
    onhelp,
  }: {
    commands: Partial<Record<CommandId, Command>>;
    plat: Platform;
    /** The "?" key: open the keyboard-shortcuts dialog. */
    onhelp: () => void;
  } = $props();
</script>

<svelte:window
  onkeydown={(e) => {
    // "?" needs Shift on most layouts, so it can't go through the combo matcher; never while typing.
    if (e.key === "?" && !isModalOpen() && !e.defaultPrevented && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!isTypingTarget(e.target)) {
        e.preventDefault();
        onhelp();
        return;
      }
    }
    if (!isModalOpen() && !e.defaultPrevented) {
      for (const id of Object.keys(SHORTCUTS) as CommandId[]) {
        const combo = SHORTCUTS[id];
        if (!combo) continue;
        const c = commands[id];
        if (!c || c.disabled) continue;
        if (matchesEvent(combo, e, plat)) {
          // Mod+Z inside a text field / editor is the field's own undo, not the app's.
          if (id === "edit.undo" && isTypingTarget(e.target)) continue;
          e.preventDefault();
          c.run();
          return;
        }
      }
    }
    // Default webview accelerators (reload, find-on-page, print, devtools, zoom, history nav) are
    // blocked unconditionally — even while a modal is open, and regardless of whether the app has
    // its own shortcut on that key — since the app's own shortcut loop above always gets first
    // refusal and already returned if it handled the key.
    if (!e.defaultPrevented && isDefaultWebviewAccelerator(e, plat)) {
      e.preventDefault();
    }
  }}
/>
