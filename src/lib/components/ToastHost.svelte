<!-- src/lib/components/ToastHost.svelte -->
<script lang="ts">
  import { portal } from "../actions/portal";
  import { toast } from "../stores/toast.svelte";
</script>

<div class="toast-host" use:portal>
  {#each toast.toasts as t (t.id)}
    <div class="toast" class:toast-error={t.kind === "error"} role="status">
      <span>{t.message}</span>
      {#if t.action}<button class="action" onclick={() => toast.runAction(t.id)}>{t.action.label}</button>{/if}
    </div>
  {/each}
</div>

<style>
  .toast-host {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    z-index: 2000;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    pointer-events: none;
  }
  /* Neutral card with a status dot (Linear-style) rather than a solid colored banner. */
  .toast {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    background: var(--popover);
    color: var(--fg);
    border: 1px solid var(--c-surface1);
    padding: 0.625rem 0.875rem;
    border-radius: var(--radius-lg);
    font-size: var(--fs);
    box-shadow: var(--shadow-sm);
    animation: toast-in 0.15s ease-out;
  }
  .toast::before {
    content: "";
    width: 0.4375rem;
    height: 0.4375rem;
    border-radius: 50%;
    flex: none;
    background: var(--ok-strong);
  }
  .action {
    pointer-events: auto; margin-left: 0.25rem; padding: 0.125rem 0.5rem; border: none;
    border-radius: var(--radius-sm); background: var(--menu-hover); color: var(--fg);
    font-size: var(--fs); font-weight: 500; cursor: pointer;
  }
  .action:hover { background: var(--c-surface1); }
  .toast-error::before { background: var(--error); }
  @keyframes toast-in {
    from { opacity: 0; transform: translateY(0.5rem); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
