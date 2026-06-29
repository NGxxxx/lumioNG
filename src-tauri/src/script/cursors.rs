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
    pub fn insert(&mut self, cursor: Cursor<Document>) -> u32 {
        let id = self.next;
        self.next += 1;
        self.open.insert(id, cursor);
        id
    }

    /// Pull up to `n` docs as ExtJSON; returns (rows, exhausted). Closes the cursor when drained.
    pub async fn fetch(&mut self, handle: u32, n: usize) -> Result<(Vec<String>, bool), AppError> {
        let cursor = self
            .open
            .get_mut(&handle)
            .ok_or_else(|| AppError::Query("unknown cursor".into()))?;
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
        if exhausted {
            self.open.remove(&handle);
        }
        Ok((rows, exhausted))
    }

    pub fn close(&mut self, handle: u32) {
        self.open.remove(&handle);
    }
    pub fn close_all(&mut self) {
        self.open.clear();
    }
    pub fn open_count(&self) -> usize {
        self.open.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn close_all_empties_the_store() {
        let mut s = CursorStore::default();
        assert_eq!(s.open_count(), 0);
        s.close(123); // no-op on unknown handle
        s.close_all();
        assert_eq!(s.open_count(), 0);
    }
}
