//! Per-run registry of open server-side cursors (handle → driver cursor).
use crate::bson_json::doc_to_canonical_string;
use crate::error::AppError;
use futures::TryStreamExt;
use mongodb::bson::Document;
use mongodb::Cursor;
use std::collections::HashMap;

/// Per-call cap on total row-JSON bytes a single `drain()` pulls, so a handful of huge documents can't blow the QuickJS heap before the JS-side row cap (__CAP) ever kicks in.
pub const MAX_DRAIN_BYTES: usize = 20 * 1024 * 1024;

#[derive(Default)]
pub struct CursorStore {
    next: u32,
    open: HashMap<u32, Cursor<Document>>,
}

impl CursorStore {
    /// Reserve the next handle id without storing a cursor.
    pub fn next_handle(&mut self) -> u32 {
        let id = self.next;
        self.next += 1;
        id
    }

    /// Store a cursor under a specific (already-reserved) handle id.
    pub fn put(&mut self, handle: u32, cursor: Cursor<Document>) {
        self.open.insert(handle, cursor);
    }

    /// Remove and return a cursor so it can be drained without holding the store's RefCell borrow across `.await` (clippy `await_holding_refcell_ref`).
    pub fn take(&mut self, handle: u32) -> Option<Cursor<Document>> {
        self.open.remove(&handle)
    }

    /// Pull up to `n` docs as ExtJSON from an owned cursor, stopping early once `max_bytes` accumulates (`0` = unlimited); `exhausted` is true only if the cursor itself ran out, not on a byte-budget stop.
    pub async fn drain(
        cursor: &mut Cursor<Document>,
        n: usize,
        max_bytes: usize,
    ) -> Result<(Vec<String>, bool), AppError> {
        let mut rows = Vec::new();
        let mut bytes = 0usize;
        let mut exhausted = false;
        for _ in 0..n {
            match cursor.try_next().await? {
                Some(d) => {
                    let s = doc_to_canonical_string(d)?;
                    bytes += s.len();
                    rows.push(s);
                    if max_bytes != 0 && bytes >= max_bytes {
                        break;
                    }
                }
                None => {
                    exhausted = true;
                    break;
                }
            }
        }
        Ok((rows, exhausted))
    }

    pub fn close(&mut self, handle: u32) {
        self.open.remove(&handle);
    }
    pub fn close_all(&mut self) {
        self.open.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn close_and_close_all_leave_an_empty_store() {
        let mut s = CursorStore::default();
        assert!(s.open.is_empty());
        s.close(123); // no-op on unknown handle
        s.close_all();
        assert!(s.open.is_empty());
    }
}
