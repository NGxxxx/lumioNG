import type { InsertMode } from "../api/documents";
import { metadataPathFor } from "../domain/collectionMetadata";
import { describeImportTarget, describeSqlImportTargets, isLargeImportFile } from "../domain/importPlan";
import { validateCollectionName } from "../domain/namespaces";
import { pickFile, pickFiles, pickDirectory, listFolderFiles, fileSize, readOptionalTextFile } from "./desktop";
import { createImportBatch } from "./importBatch.svelte";
import { createImportJob } from "./importJob.svelte";
import { createCsvImport } from "./csvImport.svelte";
import { createSqlImport } from "./sqlImport.svelte";
import { errorMessage } from "../api/errors";
import { jobs, importJobSource, phaseJobSource } from "./jobs.svelte";

import { importFormatOf, type ImportFormat } from "../domain/importBatch";
export { importFormatOf, type ImportFormat };

const FILE_FILTERS = [{ name: "JSON / JSONL / BSON / SQL / CSV", extensions: ["json", "jsonl", "bson", "sql", "csv"] }];


/** Single-screen import: pick (or change) a file, adjust target and options on one view, run, then
 *  see progress and results in place — "Back" after a failure keeps every choice. */
export function createImportDialog(args: { sessionId: string; db: string; coll: string | null; existingCollections: string[] }) {
  const { sessionId, db } = args;

  let path = $state("");
  let size = $state<number | null>(null);
  let target = $state(args.coll ?? "");
  let insertMode = $state<InsertMode>("skipDuplicates");
  // Companion `.metadata.json` next to the file (single-collection formats only).
  let metadataBundle = $state<string | null>(null);
  let restoreMetadata = $state(true);
  let view = $state<"setup" | "run">("setup");
  let csv = $state.raw<ReturnType<typeof createCsvImport> | null>(null);
  let sql = $state.raw<ReturnType<typeof createSqlImport> | null>(null);
  let job = $state.raw<ReturnType<typeof createImportJob> | null>(null);
  // Several files or a folder (database-level import only): one collection per file.
  let batch = $state.raw<ReturnType<typeof createImportBatch> | null>(null);
  let folderError = $state<string | null>(null);
  // Bumped per chosen file so late size/metadata answers for a previous file are ignored.
  let fileSeq = 0;

  const format = $derived<ImportFormat | null>(path ? importFormatOf(path) : null);
  const fileName = $derived(path.replace(/^.*[\\/]/, ""));
  const large = $derived(size !== null && isLargeImportFile(size));
  const targetError = $derived(format && format !== "sql" ? validateCollectionName(target.trim()) : null);
  const targetPlan = $derived(format && format !== "sql" ? describeImportTarget(target, args.existingCollections) : null);
  const sqlTargetError = $derived(sql && sql.targetColl.trim() ? validateCollectionName(sql.targetColl.trim()) : null);
  const sqlTargetPlan = $derived(sql && sql.selected.size > 0 ? describeSqlImportTargets([...sql.selected], sql.targetColl) : null);

  const running = $derived(
    (sql?.phase === "running") || (csv?.phase === "running") || (job?.running ?? false),
  );
  const finished = $derived(
    view === "run" && (format === "sql" ? sql?.phase === "done" : format === "csv" ? csv?.phase === "done" : !!job?.finished && !job.error),
  );
  /** The run ended without finishing (the store reverted to its options, or the job failed). */
  const failed = $derived(view === "run" && !running && !finished);

  const canStart = $derived.by(() => {
    if (view !== "setup" || !format || running) return false;
    if (format === "sql") return !!sql && sql.phase !== "loading" && sql.selected.size > 0 && !sqlTargetError;
    if (targetError) return false;
    if (format === "csv") return !!csv && csv.phase === "config" && csv.columns.length > 0;
    return true;
  });

  async function setFile(p: string) {
    const seq = ++fileSeq;
    batch = null;
    folderError = null;
    path = p;
    size = null;
    metadataBundle = null;
    csv = null;
    sql = null;
    job = null;
    const f = importFormatOf(p);
    if (f === "sql") {
      sql = createSqlImport(sessionId, db, p, args.coll, insertMode);
      void sql.loadPreview();
    } else if (f === "csv") {
      csv = createCsvImport(sessionId, db, target.trim(), p, insertMode);
      void csv.loadPreview();
    }
    const [bytes, bundle] = await Promise.all([
      fileSize(p).catch(() => null),
      f === "sql" ? Promise.resolve(null) : readOptionalTextFile(metadataPathFor(p)).catch(() => null),
    ]);
    if (seq !== fileSeq) return;
    size = bytes;
    metadataBundle = bundle;
  }

  function setBatch(paths: string[]) {
    fileSeq++;
    path = "";
    size = null;
    metadataBundle = null;
    csv = null;
    sql = null;
    job = null;
    folderError = null;
    batch = createImportBatch({ sessionId, db, paths });
  }

  /** A database-level import may pick several files at once; a collection-level one picks one. */
  async function browse() {
    if (args.coll !== null) {
      const p = await pickFile(FILE_FILTERS);
      if (p) await setFile(p);
      return;
    }
    const picked = await pickFiles(FILE_FILTERS);
    if (picked.length === 1) await setFile(picked[0]);
    else if (picked.length > 1) setBatch(picked);
  }

  /** Every importable file of a folder (e.g. a `mongodump` database directory). */
  async function browseFolder() {
    const dir = await pickDirectory();
    if (!dir) return;
    try {
      setBatch(await listFolderFiles(dir));
    } catch (e) {
      folderError = errorMessage(e);
    }
  }

  function start() {
    if (!canStart || !format) return;
    const restore = restoreMetadata ? metadataBundle : null;
    const t = target.trim();
    if (format === "sql") {
      sql!.setInsertMode(insertMode);
      void sql!.run();
      jobs.register(phaseJobSource(sql!, db));
    } else if (format === "csv") {
      csv!.setColl(t);
      csv!.setInsertMode(insertMode);
      void csv!.run(restore);
      jobs.register(phaseJobSource(csv!, `${db}.${t}`));
    } else {
      job = createImportJob({ sessionId, db, coll: t, path, insertMode, restoreMetadataBundle: restore });
      void job.run();
      jobs.register(importJobSource(job, `${db}.${t}`));
    }
    view = "run";
  }

  /** After a failed run: back to the options, with the file, target and CSV/SQL choices intact. */
  function back() {
    if (running) return;
    job = null;
    view = "setup";
  }

  /** After a finished run: start over with a new file, keeping the target and insert mode. */
  function importAnother() {
    if (running) return;
    fileSeq++;
    path = "";
    size = null;
    metadataBundle = null;
    csv = null;
    sql = null;
    job = null;
    batch = null;
    view = "setup";
  }

  return {
    get path() { return path; },
    get fileName() { return fileName; },
    get format() { return format; },
    get size() { return size; },
    get large() { return large; },
    get target() { return target; },
    set target(v: string) { target = v; },
    get targetError() { return targetError; },
    get targetPlan() { return targetPlan; },
    get insertMode() { return insertMode; },
    set insertMode(v: InsertMode) { insertMode = v; },
    get metadataBundle() { return metadataBundle; },
    get metadataFile() { return path ? metadataPathFor(path).replace(/^.*[\\/]/, "") : ""; },
    get restoreMetadata() { return restoreMetadata; },
    set restoreMetadata(v: boolean) { restoreMetadata = v; },
    get csv() { return csv; },
    get sql() { return sql; },
    get sqlTargetError() { return sqlTargetError; },
    get sqlTargetPlan() { return sqlTargetPlan; },
    get job() { return job; },
    get batch() { return batch; },
    get folderError() { return folderError; },
    get multiFile() { return args.coll === null; },
    get view() { return view; },
    get running() { return running; },
    get finished() { return finished; },
    get failed() { return failed; },
    get canStart() { return canStart; },
    setFile,
    browse,
    browseFolder,
    start,
    back,
    importAnother,
  };
}
