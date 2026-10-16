<!-- Explains why a Watch mode can't run here (server type, permissions, read-only…) and what to do. -->
<script lang="ts">
  import type { Snippet } from "svelte";

  let { title, body, detail, icon = "info", children }: {
    title: string;
    body: string;
    /** The server's own message, shown small for reference. */
    detail?: string | null;
    icon?: "info" | "lock" | "blocked";
    children?: Snippet;
  } = $props();
</script>

<div class="notice" role="status">
  <div class="icon" class:lock={icon === "lock"} class:blocked={icon === "blocked"} aria-hidden="true">
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      {#if icon === "lock"}
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
      {:else if icon === "blocked"}
        <circle cx="8" cy="8" r="5.5" /><path d="M4.2 11.8l7.6-7.6" />
      {:else}
        <circle cx="8" cy="8" r="5.5" /><path d="M8 7.2v3.6M8 5.2v.1" />
      {/if}
    </svg>
  </div>
  <div class="text">
    <h3>{title}</h3>
    <p>{body}</p>
    {#if children}<div class="extra">{@render children()}</div>{/if}
    {#if detail}<p class="detail">{detail}</p>{/if}
  </div>
</div>

<style>
  .notice { display: flex; gap: 0.875rem; max-width: 38rem; margin: 2.5rem auto; padding: 0 1.25rem; }
  .icon {
    flex: none; width: 2.25rem; height: 2.25rem; border-radius: 50%; display: grid; place-items: center;
    color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--panel));
  }
  .icon.lock { color: var(--warn-fg); background: var(--warn-bg); }
  .icon.blocked { color: var(--muted); background: var(--hover); }
  h3 { margin: 0.375rem 0 0.375rem; font-size: 0.9375rem; font-weight: 600; color: var(--fg); }
  p { margin: 0; color: var(--muted); line-height: 1.55; }
  .extra { margin-top: 0.75rem; display: flex; flex-direction: column; align-items: flex-start; gap: 0.625rem; }
  .detail {
    margin-top: 0.75rem; font-family: var(--mono); font-size: 0.6875rem; color: var(--c-overlay1);
    border-left: 2px solid var(--border); padding-left: 0.5rem; word-break: break-word;
  }
</style>
