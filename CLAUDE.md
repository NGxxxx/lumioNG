# monglumio — Structure & Conventions

MongoDB GUI: **Tauri + Rust** (backend) · **SvelteKit + Svelte 5 runes** (frontend) ·
**TanStack Table/Virtual** (data grid). Positioning: lightweight, fast, table-first.

**Core principle:** keep Rust as thin as possible (connect + query + serialize → return string);
all display logic lives in Svelte. **The contract between the two layers is a Canonical Extended
JSON string.**

---

## Frontend structure — layered, one-way dependency

```
src/lib/
  api/          # ONLY place that calls Rust via invoke. One file per command group.
  domain/       # PURE logic (no Tauri, no Svelte). Independently testable.
  stores/       # State + actions (Svelte 5 runes, factory). .svelte.ts files
  components/   # ONLY rendering + binding to store/api. No business logic.
```

**Dependency direction (must not be violated):** `components → stores → api`, and every layer may
use `domain`. `domain` must **never** import upward into `api`/`stores`/`components`.

### Where to put new code
- **New Rust command** → add an `invoke` wrapper in `api/<group>.ts` (e.g. `connection.ts`,
  `documents.ts`). Never call `invoke` anywhere outside `api/`.
- **Pure logic** (parsing, transforms, type inference, building columns…) → `domain/`. Must have a
  `.test.ts`.
- **State + actions for a screen/block** → a store factory in `stores/` (see pattern below).
- **UI** → `components/`. Components pull data/actions from a store or props and hold no business
  logic themselves; only DOM glue (focus, scroll, keyboard shortcuts).

### Store factory pattern (project standard)
State + actions are wrapped in `createX(...)`, returning **getters** for state and functions for
actions (see `stores/workspace.svelte.ts`, `stores/collectionView.svelte.ts`):

```ts
export function createX(args) {
  let items = $state<T[]>([]);
  function doThing() { /* calls api/*, uses domain/* */ }
  return {
    get items() { return items; },
    doThing,
  };
}
```
- Need two-way binding (e.g. `bind:value`) → expose a `get`/`set` pair for that field.
- Test stores via `vi.mock("../api/...")` — no DOM needed (see `collectionView.test.ts`).

### Svelte 5 conventions
- Props are **immutable for the component's lifetime** when it's remounted by key (e.g. tabs keyed
  by `id`). When initializing `$state`/creating a store from props, wrap it in `untrack(() => …)`
  to avoid the `state_referenced_locally` warning; read-only values derived from props use
  `$derived` (see `DocumentForm.svelte`).
- **Large document arrays use `$state.raw`, NEVER `$state`** (see `docs`/`pageDocs` in
  `collectionView.svelte.ts`, `queryRun.svelte.ts`). `$state` deep-proxies every nested field →
  25k documents blows RAM past 1GB (each field becomes a signal/proxy). `$state.raw` keeps the doc
  as a plain object; still reactive when **the whole array is reassigned**.
  ⚠️ Trade-off: with raw, **in-place mutation does not re-render**. Every update must be immutable —
  build a new doc/array and reassign:
  - ✅ `docs[row] = { ...docs[row], [key]: v }; docs = [...docs];` (current inline edit)
  - ✅ `docs = docs.filter(...)` / `docs = batch`
  - ❌ `docs[row].field = v` or `docs[row].a.b = v` **without** reassigning `docs` → data changes but
    the UI stays frozen (silent bug). If nested-field editing is added later, still build a new doc
    and reassign.
- Tests live **next to** the source file (`foo.ts` + `foo.test.ts`).

---

## Backend structure — commands organized by domain

```
src-tauri/src/
  state.rs        # AppState + helpers. Get the client via: `let client = state.client().await?;`
  error.rs        # AppError (serializes { kind, message } to the frontend). No unwrap in command layer.
  bson_json.rs    # BSON → Canonical ExtJSON (to frontend)
  json_bson.rs    # Canonical ExtJSON → BSON (from frontend)
  commands/
    mod.rs        # `pub mod <group>;` (do NOT re-export functions — see macro note below)
    connection.rs # connect, list_namespaces, DbInfo…
    documents.rs  # query_page, insert/replace/delete…
```

### Backend conventions
- **Always get the client** via `state.client().await?` (don't repeat lock/as_ref/clone boilerplate).
- **New command** → place it in `commands/<group>.rs` matching its domain (create a new group if
  needed), then register it with its **full path** in `generate_handler!` in `lib.rs`:
  `commands::<group>::<command>`.
  ⚠️ `#[tauri::command]` generates a `__cmd__<command>` macro in the same module; `pub use`
  re-exporting the function does **not** carry that macro along — always use the full path, don't
  re-export and call `commands::<command>`.
- Rust knows nothing about "columns" or "display". Every document is serialized to a **Canonical
  Extended JSON** string; the frontend parses and renders it.
- `bson_json`/`json_bson` are the sharp edges — keep thorough round-trip tests for every BSON type.

---

## Workflow & testing
- Before reporting "done": run and verify **green** (never assume):
  - Frontend: `npm test` and `npm run check` (target **0 errors, 0 warnings**).
  - Backend: `cargo test --manifest-path src-tauri/Cargo.toml`.