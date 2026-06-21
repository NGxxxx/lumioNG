import { aggregate } from "../api/documents";
import type { Doc } from "../domain/columns";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { aggregateCmd } from "../domain/mongosh";
import { parseAggregateStatement, pipelineHasTrailingLimit } from "../domain/aggregate";
import { mergeColumns, type ColumnField } from "../domain/schema";
import { computeColumnWidths, clampWidth } from "../domain/colwidth";
import { pageCount, clampPage } from "../domain/paging";

const SAFETY_CAP = 200;

/** Per-tab state for one aggregate Query tab: parse + run + client-side paging + column widths. */
export function createQueryRun(initialStatement: string) {
  let statementText = $state(initialStatement);
  let docs = $state<Doc[]>([]);
  let columns = $state<ColumnField[]>([]);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let capped = $state(false);
  let ran = $state(false);
  let view = $state<"grid" | "tree">("grid");
  let pageSize = $state(50);
  let pageReq = $state(1);
  let colWidths = $state<Record<string, number>>({});
  let defaultColWidths = $state<Record<string, number>>({});

  const totalCount = $derived(docs.length);
  const pgCount = $derived(pageCount(totalCount, pageSize));
  const page = $derived(clampPage(pageReq, pgCount));
  const pageDocs = $derived(docs.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize));

  async function exec(db: string | null, forceNoLimit: boolean) {
    if (!db) {
      error = "Select a database first.";
      return;
    }
    let parsed: { coll: string; pipelineText: string };
    try {
      parsed = parseAggregateStatement(statementText);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      return;
    }
    const limit = forceNoLimit || pipelineHasTrailingLimit(parsed.pipelineText) ? null : SAFETY_CAP;
    loading = true;
    try {
      const res = await aggregate(db, parsed.coll, parsed.pipelineText, limit);
      docs = res;
      columns = mergeColumns(null, res);
      defaultColWidths = computeColumnWidths(columns, res);
      colWidths = { ...defaultColWidths };
      capped = limit !== null && res.length === limit;
      pageReq = 1;
      commandLog.push(aggregateCmd(parsed.coll, parsed.pipelineText));
      error = null;
      ran = true;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  return {
    get statementText() { return statementText; },
    set statementText(v: string) { statementText = v; },
    get docs() { return docs; },
    get columns() { return columns; },
    get pageDocs() { return pageDocs; },
    get colWidths() { return colWidths; },
    get error() { return error; },
    get loading() { return loading; },
    get capped() { return capped; },
    get ran() { return ran; },
    get view() { return view; },
    set view(v: "grid" | "tree") { view = v; },
    get pageSize() { return pageSize; },
    get currentPage() { return page; },
    get pageCount() { return pgCount; },
    get totalCount() { return totalCount; },
    setColWidth: (path: string, px: number) => { colWidths = { ...colWidths, [path]: clampWidth(px) }; },
    resetColWidth: (path: string) => { colWidths = { ...colWidths, [path]: defaultColWidths[path] ?? 160 }; },
    goToPage: (p: number) => { pageReq = clampPage(p, pgCount); },
    setPageSize: (n: number) => { pageSize = Math.max(1, Math.floor(n) || 50); pageReq = 1; },
    run: (db: string | null) => exec(db, false),
    runNoLimit: (db: string | null) => exec(db, true),
  };
}
