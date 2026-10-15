import type { Doc } from "./doc";
import type { ColumnField } from "./schema";
import type { SortKey } from "./grid";

/** A context-menu entry, rendered by `components/ContextMenu.svelte`. */
export type MenuItem = { label: string; action: string; disabled?: boolean; children?: MenuItem[] };

/** Shared grid+pager shape so `ResultGrid`/`ResultPager` can render either `collectionView` or `queryScript` state without knowing which backs them; `sortKeys`/`toggleSort`/`selectAll` are optional since only `collectionView` supports UI-driven sort and Ctrl+A select-all. */
export interface GridPageView {
  readonly docs: Doc[];
  /** Indices into `docs` for rows matching the active quick-search term, in order; `null` means
   *  no search is active (render every row). See `domain/search.ts`. */
  readonly visibleIndices: number[] | null;
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
  /** Replace the selection (real indices into `docs`) — keyboard navigation. */
  setSelected?(rows: Set<number>): void;
  selectAll?(): void;
  readonly menu: { x: number; y: number; row: number; key: string; source?: "grid" | "tree" } | null;
  openMenu(e: MouseEvent, row: number, key: string, source?: "grid" | "tree"): void;
  closeMenu(): void;
  menuItems(): MenuItem[];

  readonly editing: { row: number; key: string; kind: "inline" | "modal" } | null;
  editText: string;
  /** True while the modal editor's text is still being computed for a large field (see startEdit). */
  readonly editTextLoading: boolean;
  readonly editError: string | null;
  readonly saving: boolean;
  startEdit(row: number, key: string): void;
  commitEdit(): void | Promise<void>;
  cancelEdit(): void;
  onEditBlur(): void;

  /** Columns pinned to the left (sticky); collection view only. */
  readonly pinned?: Set<string>;
  /** Column header menu (▾ / right-click on a header); collection view only. */
  headerMenuItems?(path: string): MenuItem[];
  onHeaderMenuSelect?(path: string, action: string): void | Promise<void>;

  readonly sortKeys?: SortKey[];
  toggleSort?(path: string, shift: boolean): void;

  // Grid-scoped keyboard shortcuts (Slice 4) — all optional since the two backing stores
  // (collectionView vs. queryScript) aren't symmetric in what they support.
  /** Ctrl+Delete: delete the current selection (both stores support this). */
  requestDeleteSelected?(): void;
  /** Ctrl+C: copy the current selection as a JSON array (collectionView only). */
  copySelectedAsJson?(): void;
  /** Ctrl+I: flip which rows are selected, within the currently visible (filtered) set. */
  invertSelection?(): void;
  /** Insert: build a blank document skeleton to open in the insert form (collectionView only). */
  newDocument?(): Doc;
  /** Ctrl+Insert: build a duplicate of the single selected document (collectionView only); null if not exactly one row is selected. */
  duplicateSelected?(): Doc | null;
}
