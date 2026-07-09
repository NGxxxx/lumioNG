import type { Doc } from "./doc";
import type { ColumnField } from "./schema";
import type { SortKey } from "./grid";
import type { MenuItem } from "../components/ContextMenu.svelte";

/**
 * Shared shape both `collectionView.svelte.ts` and `queryScript.svelte.ts` expose for their
 * grid+pager region, so `ResultGrid.svelte`/`ResultPager.svelte` can render either without
 * knowing which store backs them. `sortKeys`/`toggleSort` and `selectAll` are optional: only
 * `collectionView` implements UI-driven column-header sort and Ctrl+A select-all — Query tab's
 * sort is script-defined, and it has no "select all" concept.
 */
export interface GridPageView {
  readonly docs: Doc[];
  readonly columnFields: ColumnField[];
  readonly colWidths: Record<string, number>;
  setColWidth(path: string, px: number): void;
  resetColWidth(path: string): void;

  readonly currentPage: number;
  readonly pageCount: number;
  readonly totalCount: number;
  readonly pageSize: number;
  readonly allShown: boolean;
  readonly loading: boolean;
  goToPage(n: number): void | Promise<void>;
  nextPage(): void | Promise<void>;
  prevPage(): void | Promise<void>;
  firstPage(): void | Promise<void>;
  lastPage(): void | Promise<void>;
  setPageSize(n: number): void | Promise<void>;
  requestShowAll(): void | Promise<void>;

  readonly selected: Set<number>;
  clickRow(row: number, mods: { ctrl: boolean; shift: boolean }): void;
  selectAll?(): void;
  readonly menu: { x: number; y: number; row: number; key: string } | null;
  openMenu(e: MouseEvent, row: number, key: string): void;
  closeMenu(): void;
  menuItems(): MenuItem[];

  readonly editing: { row: number; key: string } | null;
  editText: string;
  readonly editError: string | null;
  startEdit(row: number, key: string): void;
  commitEdit(): void | Promise<void>;
  cancelEdit(): void;
  onEditBlur(): void;

  readonly sortKeys?: SortKey[];
  toggleSort?(path: string, shift: boolean): void;
}
