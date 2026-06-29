//! Per-run registry of open server-side cursors (handle → driver cursor).
use crate::bson_json::doc_to_canonical_string;
use crate::error::AppError;
use futures::TryStreamExt;
use mongodb::bson::Document;
use mongodb::Cursor;
use std::collections::HashMap;

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

    /// Remove and return a cursor so it can be drained without holding the store's RefCell
    /// borrow across `.await` (clippy `await_holding_refcell_ref`).
    pub fn take(&mut self, handle: u32) -> Option<Cursor<Document>> {
        self.open.remove(&handle)
    }

    /// Pull up to `n` docs as ExtJSON from an owned cursor; returns (rows, exhausted).
    /// Free of `&mut self`, so callers borrow the store only to take/put, never across `.await`.
    pub async fn drain(
        cursor: &mut Cursor<Document>,
        n: usize,
    ) -> Result<(Vec<String>, bool), AppError> {
        let mut rows = Vec::new();
        let mut exhausted = false;
        for _ in 0..n {
            match cursor.try_next().await? {
                Some(d) => rows.push(doc_to_canonical_string(d)?),
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
