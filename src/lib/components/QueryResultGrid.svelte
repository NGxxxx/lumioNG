<script lang="ts">
  import { getByPath, type ColumnField } from "../domain/schema";
  import type { Doc } from "../domain/columns";
  import BsonCell from "./BsonCell.svelte";
  import ContextMenu, { type MenuItem } from "./ContextMenu.svelte";

  let { columns, docs, colWidths, onResize, onReset,
        selected, menu, menuItems, onRowClick, onOpenMenu, onMenuSelect, onCloseMenu }: {
    columns: ColumnField[];
    docs: Doc[];
    colWidths: Record<string, number>;
    onResize: (path: string, px: number) => void;
    onReset: (path: string) => void;
    selected: Set<number>;
    menu: { x: number; y: number; row: number; key: string } | null;
    menuItems: () => MenuItem[];
    onRowClick: (row: number, mods: { ctrl: boolean; shift: boolean }) => void;
    onOpenMenu: (e: MouseEvent, row: number, key: string) => void;
    onMenuSelect: (action: string) => void;
    onCloseMenu: () => void;
  } = $props();

  const FALLBACK_W = 160;
  const ROWNUM_W = 42;
  const totalWidth = $derived(
    ROWNUM_W + columns.reduce((s, c) => s + (colWidths[c.path] ?? FALLBACK_W), 0),
  );

  let resizing = false;
  function startResize(e: MouseEvent, path: string) {
    e.preventDefault();
    e.stopPropagation();
    resizing = true;
    const startX = e.clientX;
    const startW = colWidths[path] ?? FALLBACK_W;
    const move = (ev: MouseEvent) => onResize(path, startW + (ev.clientX - startX));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setTimeout(() => { resizing = false; }, 0);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
</script>

{#if columns.length === 0}
  <div class="empty">No results</div>
{:else}
  <div class="scroller">
    <table style="width:{totalWidth}px">
      <colgroup>
        <col style="width:{ROWNUM_W}px" />
        {#each columns as c (c.path)}<col style="width:{colWidths[c.path] ?? FALLBACK_W}px" />{/each}
      </colgroup>
      <thead>
        <tr>
          <th class="rownum">#</th>
          {#each columns as c (c.path)}
            <th><span class="colname">{c.path}</span><span
                class="col-resize" role="presentation"
                onmousedown={(e) => startResize(e, c.path)}
                ondblclick={(e) => { e.stopPropagation(); onReset(c.path); }}></span></th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each docs as d, i (i)}
          <tr style="background:{selected.has(i) ? 'var(--row-selected)' : (i % 2 === 0 ? 'var(--zebra)' : 'var(--zebra-alt)')}"
            onclick={(e) => onRowClick(i, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}>
            <td class="rownum">{i + 1}</td>
            {#each columns as c (c.path)}
              {@const val = getByPath(d, c.path)}
              <td class="data-cell" oncontextmenu={(e) => onOpenMenu(e, i, c.path)}>{#if val !== undefined}<BsonCell value={val} />{/if}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onselect={onMenuSelect} onclose={onCloseMenu} />
{/if}

<style>
  .scroller { overflow: auto; height: 100%; }
  .empty { padding: 16px; color: var(--muted); font-size: 12px; }
  table { border-collapse: collapse; table-layout: fixed; font-size: 12px; white-space: nowrap; }
  th { background: linear-gradient(var(--th-grad-top), var(--th-grad-bottom)); border: 1px solid #d0d0d0; padding: 4px 9px; font-weight: 600; position: sticky; top: 0; z-index: 2; text-align: left; color: #222; }
  .colname { font-weight: 600; }
  .rownum { width: 42px; text-align: right; color: #999; font-size: 11px; padding: 3px 6px; }
  td { border: 1px solid var(--cell-border); padding: 0; height: 22px; overflow: hidden; text-overflow: ellipsis; }
  td.data-cell :global(.cell) { padding: 0 9px; display: inline-block; height: 22px; line-height: 22px; }
  .col-resize { position: absolute; top: 0; right: 0; width: 6px; height: 100%; cursor: col-resize; user-select: none; }
  .col-resize:hover { background: var(--tab-active-border); opacity: 0.5; }
</style>
