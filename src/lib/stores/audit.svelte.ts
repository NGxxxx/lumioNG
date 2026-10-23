import { untrack } from "svelte";
import { auditExport, auditQuery, auditSetScope, auditVerify } from "../api/audit";
import { errorMessage } from "../api/errors";
import { parseAuditScope, rangeBounds, type AuditEntry, type AuditRange, type AuditScope, type VerifyReport } from "../domain/audit";
import { prefs } from "./prefs.svelte";

/** Prefs key of the audited-environments choice (an `audit-` key, so settings export/import never carries it). */
const SCOPE_KEY = "audit-scope";

/** Audit log screen state plus the audited-environments setting, which is pushed down to Rust. */
export function createAudit() {
  let scope = $state<AuditScope>(untrack(() => parseAuditScope(prefs.getItem(SCOPE_KEY))));
  prefs.afterHydrate(() => {
    scope = parseAuditScope(prefs.getItem(SCOPE_KEY));
    push();
  });
  let entries = $state.raw<AuditEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let report = $state<VerifyReport | null>(null);
  let seq = 0;

  function push() {
    auditSetScope(scope).catch(() => {
      /* Rust keeps auditing PROD only, the safe default */
    });
  }

  return {
    get scope() { return scope; },
    get entries() { return entries; },
    get loading() { return loading; },
    get error() { return error; },
    get report() { return report; },
    /** Called once at app start: Rust defaults to PROD only until it hears the saved choice. */
    init() {
      push();
    },
    setScope(v: AuditScope) {
      scope = v;
      prefs.setItem(SCOPE_KEY, v);
      push();
    },
    async load(range: AuditRange, environment: string) {
      const my = ++seq;
      loading = true;
      error = null;
      try {
        const [from, to] = rangeBounds(range, Date.now());
        const list = await auditQuery(from, to, environment || null);
        if (my === seq) entries = list;
      } catch (e) {
        if (my === seq) error = errorMessage(e);
      } finally {
        if (my === seq) loading = false;
      }
    },
    async verify() {
      report = null;
      try {
        report = await auditVerify();
      } catch (e) {
        error = errorMessage(e);
      }
    },
    /** Resolves to the number of lines written. */
    async exportTo(path: string): Promise<number> {
      return await auditExport(path);
    },
  };
}

export const audit = createAudit();
