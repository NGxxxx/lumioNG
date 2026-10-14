<!-- src/lib/components/ToastHost.svelte -->
<script lang="ts">
  import { portal } from "../actions/portal";
  import { toast } from "../stores/toast.svelte";
</script>

<div class="toast-host" use:portal>
  {#each toast.toasts as t (t.id)}
    <div class="toast" class:toast-error={t.kind === "error"} role="status">{t.message}</div>
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
  .toast {
    background: var(--ok-strong);
    color: #fff;
    padding: 0.5rem 0.875rem;
    border-radius: var(--radius);
    font-size: var(--fs);
    box-shadow: var(--shadow-sm);
    animation: toast-in 0.15s ease-out;
  }
  .toast-error { background: var(--error); }
  @keyframes toast-in {
    from { opacity: 0; transform: translateY(0.5rem); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
