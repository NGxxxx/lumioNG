# monglumio — Hướng dẫn cấu trúc & quy ước

MongoDB GUI: **Tauri + Rust** (backend) · **SvelteKit + Svelte 5 runes** (frontend) ·
**TanStack Table/Virtual** (data grid). Định vị: nhẹ, nhanh, table-first.

**Nguyên tắc xuyên suốt:** Rust mỏng nhất có thể (connect + query + serialize → trả string);
mọi logic hiển thị đẩy lên Svelte. **Hợp đồng giữa hai tầng = chuỗi Canonical Extended JSON.**

---

## Cấu trúc frontend — phân tầng, phụ thuộc một chiều

```
src/lib/
  api/          # CHỈ nơi gọi Rust qua invoke. Mỗi file = một nhóm command.
  domain/       # Logic THUẦN (không Tauri, không Svelte). Test được độc lập.
  stores/       # State + hành động (Svelte 5 runes, factory). File .svelte.ts
  components/   # CHỈ render + bind store/api. Không chứa business logic.
```

**Chiều phụ thuộc (không được vi phạm):** `components → stores → api`, và mọi tầng dùng `domain`.
`domain` **không** import ngược lên `api`/`stores`/`components`.

### Đặt code mới ở đâu
- **Thêm command Rust mới** → wrapper `invoke` vào `api/<nhóm>.ts` (vd `connection.ts`,
  `documents.ts`). Không gọi `invoke` ở bất kỳ đâu ngoài `api/`.
- **Logic thuần** (parse, biến đổi, suy luận kiểu, dựng cột…) → `domain/`. Phải có `.test.ts`.
- **State + thao tác của một màn hình/khối** → store factory trong `stores/` (xem mẫu dưới).
- **UI** → `components/`. Component lấy dữ liệu/hành động từ store hoặc props, tự nó không
  giữ business logic; chỉ giữ DOM glue (focus, scroll, phím tắt).

### Mẫu store factory (chuẩn của dự án)
State + actions gói trong `createX(...)`, trả về **getter** cho state và hàm cho actions
(xem `stores/workspace.svelte.ts`, `stores/collectionView.svelte.ts`):

```ts
export function createX(args) {
  let items = $state<T[]>([]);
  function doThing() { /* gọi api/*, dùng domain/* */ }
  return {
    get items() { return items; },
    doThing,
  };
}
```
- Cần binding hai chiều (vd `bind:value`) → expose cặp `get`/`set` cho field đó.
- Test store bằng cách `vi.mock("../api/...")` — không cần DOM (xem `collectionView.test.ts`).

### Quy ước Svelte 5
- Props là **bất biến trong vòng đời** khi component được mount lại theo key (vd tab theo `id`).
  Khi khởi tạo `$state`/tạo store từ props, bọc `untrack(() => …)` để tránh cảnh báo
  `state_referenced_locally`; giá trị chỉ-đọc dẫn xuất từ props dùng `$derived` (xem `DocumentForm.svelte`).
- **Mảng document lớn dùng `$state.raw`, KHÔNG dùng `$state`** (xem `docs`/`pageDocs` trong
  `collectionView.svelte.ts`, `queryRun.svelte.ts`). `$state` deep-proxy mọi field lồng nhau →
  25k document khiến RAM phình >1GB (mỗi field thành một signal/proxy). `$state.raw` giữ doc là
  object thuần; vẫn reactive khi **gán lại nguyên mảng**.
  ⚠️ Đánh đổi: với raw, **mutate tại chỗ không re-render**. Mọi cập nhật phải theo kiểu immutable —
  dựng doc/mảng mới rồi gán lại:
  - ✅ `docs[row] = { ...docs[row], [key]: v }; docs = [...docs];` (inline edit hiện tại)
  - ✅ `docs = docs.filter(...)` / `docs = batch`
  - ❌ `docs[row].field = v` hay `docs[row].a.b = v` **mà không** gán lại `docs` → đổi data nhưng UI
    đứng im (lỗi âm thầm). Nếu sau này hỗ trợ sửa field lồng nhau, vẫn phải dựng doc mới + reassign.
- Test đặt **cạnh** file nguồn (`foo.ts` + `foo.test.ts`).

---

## Cấu trúc backend — command theo domain

```
src-tauri/src/
  state.rs        # AppState + helper. Lấy client: `let client = state.client().await?;`
  error.rs        # AppError (serialize { kind, message } ra frontend). Cấm unwrap ở tầng command.
  bson_json.rs    # BSON  → Canonical ExtJSON (ra frontend)
  json_bson.rs    # Canonical ExtJSON → BSON (vào từ frontend)
  commands/
    mod.rs        # `pub mod <nhóm>;` (KHÔNG re-export hàm — xem lưu ý macro bên dưới)
    connection.rs # connect, list_namespaces, DbInfo…
    documents.rs  # query_page, insert/replace/delete…
```

### Quy ước backend
- **Lấy client** luôn qua `state.client().await?` (không lặp lại đoạn lock/as_ref/clone).
- **Thêm command mới** → đặt vào `commands/<nhóm>.rs` đúng domain (tạo nhóm mới nếu cần),
  rồi đăng ký bằng **đường dẫn đầy đủ** trong `generate_handler!` ở `lib.rs`:
  `commands::<nhóm>::<lệnh>`.
  ⚠️ `#[tauri::command]` sinh macro bạn `__cmd__<lệnh>` cùng module; `pub use` re-export hàm
  **không** mang theo macro này → phải dùng đường dẫn đầy đủ, đừng re-export rồi gọi `commands::<lệnh>`.
- Rust **không** biết "cột" hay "hiển thị". Mỗi document serialize thành **Canonical Extended JSON**
  string; frontend tự parse + render.
- `bson_json`/`json_bson` là chỗ "gai" → test round-trip dày cho mọi kiểu BSON.

---

## Quy trình & kiểm thử
- Trước khi báo "xong": chạy và xác minh **xanh** (không phỏng đoán):
  - Frontend: `npm test` và `npm run check` (mục tiêu **0 errors, 0 warnings**).
  - Backend: `cargo test --manifest-path src-tauri/Cargo.toml`.
- Tài liệu thiết kế ở `docs/superpowers/specs/`, kế hoạch ở `docs/superpowers/plans/`
  (theo lát cắt — slice).
- Git: nhánh `<type>/<kebab>` từ `master`; commit một dòng `<type>: <mô tả>`, không co-author
  (xem quy ước cá nhân ở `~/.claude/CLAUDE.md`).
