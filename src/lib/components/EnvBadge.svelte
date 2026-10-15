<!-- src/lib/components/EnvBadge.svelte — DEV / STG / PROD badge for a connection environment (text, never color alone). -->
<script lang="ts">
  import { ENV_META, type Environment } from "../domain/environment";
  import * as m from "#lib/paraglide/messages.js";

  let { env, size = "sm" }: { env: Environment; size?: "sm" | "md" } = $props();
  const meta = $derived(ENV_META[env]);
</script>

{#if meta.short}
  <span class="env {meta.tone} {size}" title={m.env_chip_title({ env: meta.short })}>{meta.short}</span>
{/if}

<style>
  .env {
    display: inline-flex; align-items: center; flex: none;
    padding: 0 0.3125rem; border-radius: var(--radius-sm);
    font-size: 0.625rem; font-weight: 600; letter-spacing: 0.04em; line-height: 1rem;
  }
  .env.md { font-size: 0.6875rem; padding: 0 0.4375rem; line-height: 1.125rem; }
  .ok { background: var(--ok-bg); color: var(--ok-fg); }
  .warn { background: var(--warn-bg); color: var(--warn-fg); }
  .danger { background: var(--error-bg); color: var(--danger); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 35%, transparent); }
</style>
