<!-- src/lib/components/Modal.svelte — shared dialog shell: backdrop + header/body/footer chrome, Escape/Enter wiring. -->
<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { portal } from "../actions/portal";
  import { backdropClose } from "../actions/backdropClose";
  import { pushModal } from "#lib/stores/modalStack.js";

  let {
    title,
    label,
    width = "26.25rem",
    maxWidth = "90vw",
    stackBody = false,
    fadeDisabled = false,
    ondismiss,
    onenter,
    enterDisabled,
    body,
    footer,
  }: {
    /** Header text. */
    title: string;
    /** Dialog aria-label; defaults to `title`. */
    label?: string;
    width?: string;
    maxWidth?: string;
    /** Body becomes a flex column with a 0.625rem gap — for forms with several fields. */
    stackBody?: boolean;
    /** Disabled footer buttons dim via opacity instead of gray text — keeps a filled primary button legible. */
    fadeDisabled?: boolean;
    /** Escape key and backdrop click. */
    ondismiss: () => void;
    onenter?: () => void;
    enterDisabled?: () => boolean;
    body: Snippet;
    footer: Snippet;
  } = $props();

  // Wrappers (not the raw props) so the registered handlers always read the current prop values.
  onMount(() => pushModal({
    onEscape: () => ondismiss(),
    onEnter: () => onenter?.(),
    enterDisabled: () => enterDisabled?.() ?? false,
  }));
</script>

<div
  class="backdrop"
  use:portal
  role="presentation"
  use:backdropClose={ondismiss}
>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-label={label ?? title}
    style:width={width}
    style:max-width={maxWidth}
  >
    <header>{title}</header>
    <div class="body" class:stack={stackBody}>{@render body()}</div>
    <footer class:fade={fadeDisabled}>{@render footer()}</footer>
  </div>
</div>

<style>
  /* overflow-y: auto — lets the backdrop scroll if a dialog is taller than the window */
  .backdrop { position: fixed; inset: 0; z-index: 1000; background: var(--backdrop); display: flex; align-items: center; justify-content: center; overflow-y: auto; }
  .modal { background: var(--popover); border: 1px solid var(--c-surface1); border-radius: 0.75rem; box-shadow: var(--shadow-lg); overflow: hidden; }
  header { padding: 0.875rem 1.125rem; font-weight: 600; font-size: 0.875rem; border-bottom: 1px solid var(--border); }
  .body { padding: 1rem 1.125rem; font-size: var(--fs); line-height: 1.5; }
  .body.stack { display: flex; flex-direction: column; gap: 0.625rem; }
  footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.75rem 1.125rem; border-top: 1px solid var(--border); background: transparent; }

  /* Body/footer content is authored in the calling dialog, so the shared bits below need :global. */
  .body :global(code) { background: var(--bg); padding: 0.0625rem 0.25rem; border-radius: var(--radius); font-family: var(--mono); }
  .body :global(input:not([type="checkbox"]):not([type="radio"])), .body :global(select) { width: 100%; box-sizing: border-box; margin-top: 0.375rem; height: 2rem; padding: 0 0.625rem; background: var(--bg); border-color: var(--c-surface1); }
  .body :global(.dlg-error) { color: var(--error); margin-top: 0.5rem; }
  .body.stack :global(.dlg-error) { margin-top: 0; }
  .modal :global(.dlg-spinner) {
    width: 0.75rem; height: 0.75rem; border-radius: 50%; flex: none;
    border: 2px solid currentColor; border-right-color: transparent;
    animation: dlg-spin 0.7s linear infinite;
  }
  @keyframes -global-dlg-spin { to { transform: rotate(360deg); } }

  footer :global(button) { display: inline-flex; align-items: center; gap: 0.375rem; height: 1.875rem; padding: 0 0.875rem; border: 1px solid var(--c-surface1); border-radius: var(--radius); background: var(--hover); color: var(--fg); font-weight: 500; cursor: pointer; }
  footer :global(button:hover:not(:disabled)) { background: var(--menu-hover); }
  footer :global(button:disabled) { cursor: default; }
  footer:not(.fade) :global(button:disabled) { color: var(--gray-b8); }
  footer.fade :global(button:disabled) { opacity: 0.6; }
  footer :global(.primary) { background: var(--run); color: var(--on-accent); border-color: transparent; font-weight: 600; }
  footer :global(.primary:hover:not(:disabled)) { background: var(--run-hover); }
  footer :global(.danger) { color: var(--error); border-color: color-mix(in srgb, var(--error) 35%, var(--c-surface1)); background: transparent; }
  footer :global(.danger:disabled) { color: var(--gray-b8); }
</style>
