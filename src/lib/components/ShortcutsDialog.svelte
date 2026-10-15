<!-- src/lib/components/ShortcutsDialog.svelte — keyboard shortcut sheet, generated from domain/commands (never hand-maintained). -->
<script lang="ts">
  import Modal from "./Modal.svelte";
  import { COMMAND_GROUPS, GRID_ALIASES, SHORTCUTS } from "../domain/commands";
  import { formatCombo, type Platform } from "../domain/shortcuts";
  import { commandLabel } from "./commandLabels";
  import * as m from "#lib/paraglide/messages.js";

  let { platform, onclose }: { platform: Platform; onclose: () => void } = $props();

  const GROUP_TITLE = {
    general: m.shortcuts_group_general,
    navigation: m.shortcuts_group_navigation,
    grid: m.shortcuts_group_grid,
    editor: m.shortcuts_group_editor,
  };
</script>

<Modal title={m.shortcuts_title()} width="44rem" ondismiss={onclose}>
  {#snippet body()}
    <div class="groups">
      {#each COMMAND_GROUPS as g (g.group)}
        {@const title = GROUP_TITLE[g.group]()}
        <section aria-label={title}>
          <h3>{title}</h3>
          <table>
            <tbody>
              {#each g.ids as id (id)}
                <tr>
                  <td class="label">{commandLabel(id)}</td>
                  <td class="keys">
                    {#each [SHORTCUTS[id]!, ...(GRID_ALIASES[id] ?? [])] as combo, i (i)}
                      {#if i > 0}<span class="or">/</span>{/if}<kbd>{formatCombo(combo, platform)}</kbd>
                    {/each}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </section>
      {/each}
    </div>
  {/snippet}
  {#snippet footer()}
    <button class="primary" onclick={onclose}>{m.common_close()}</button>
  {/snippet}
</Modal>

<style>
  .groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem 1.5rem; max-height: 65vh; overflow: auto; }
  h3 { margin: 0 0 0.375rem; font-size: 0.71875rem; font-weight: 500; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 0.25rem 0; border-bottom: 1px solid var(--row-divider); font-size: 0.78125rem; }
  .label { color: var(--c-subtext1); }
  .keys { text-align: right; white-space: nowrap; }
  .or { margin: 0 0.25rem; color: var(--muted); }
  kbd {
    display: inline-block; min-width: 1.125rem; padding: 0.0625rem 0.3125rem; text-align: center;
    border-radius: var(--radius-sm); border: 1px solid var(--c-surface1); background: var(--hover);
    font-family: var(--mono); font-size: 0.6875rem; color: var(--fg);
  }
</style>
