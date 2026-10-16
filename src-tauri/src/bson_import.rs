//! Pure helpers for concatenated-BSON import: count documents from length prefixes without
//! materializing bodies. Streaming glue lives in `commands/import_export.rs`.
use crate::error::AppError;
use std::io::Read;

/// Reads a 4-byte length prefix, distinguishing clean EOF (`Ok(None)`) from a truncated one (`Err`).
pub(crate) fn read_len_prefix<R: std::io::Read>(reader: &mut R) -> Result<Option<[u8; 4]>, AppError> {
    let mut buf = [0u8; 4];
    let mut filled = 0;
    while filled < 4 {
        match reader.read(&mut buf[filled..]).map_err(|e| AppError::Io(e.to_string()))? {
            0 => break,
            n => filled += n,
        }
    }
    match filled {
        0 => Ok(None),
        4 => Ok(Some(buf)),
        _ => Err(AppError::Parse("truncated BSON document".into())),
    }
}

/// Counts concatenated BSON documents by reading each length prefix and discarding the body, never buffering a whole document.
pub(crate) fn count_bson_docs_streaming<R: std::io::Read>(mut reader: R) -> Result<u64, AppError> {
    let mut n = 0u64;
    while let Some(len_buf) = read_len_prefix(&mut reader)? {
        let len = i32::from_le_bytes(len_buf);
        if len < 5 {
            return Err(AppError::Parse("invalid BSON document length".into()));
        }
        let body_len = (len as u64) - 4;
        let copied = std::io::copy(&mut (&mut reader).take(body_len), &mut std::io::sink())
            .map_err(|e| AppError::Io(e.to_string()))?;
        if copied != body_len {
            return Err(AppError::Parse("truncated BSON document".into()));
        }
        n += 1;
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::Document;

    #[test]
    fn count_bson_docs_streaming_counts_concatenated_documents() {
        use mongodb::bson::doc;
        let a = mongodb::bson::to_vec(&doc! {"a": 1}).unwrap();
        let b = mongodb::bson::to_vec(&doc! {"b": 2}).unwrap();
        let mut buf = a.clone();
        buf.extend_from_slice(&b);
        assert_eq!(count_bson_docs_streaming(std::io::Cursor::new(buf)).unwrap(), 2);
    }

    #[test]
    fn count_bson_docs_streaming_is_zero_for_an_empty_file() {
        assert_eq!(count_bson_docs_streaming(std::io::Cursor::new(Vec::<u8>::new())).unwrap(), 0);
    }

    #[test]
    fn count_bson_docs_streaming_rejects_a_truncated_document() {
        use mongodb::bson::doc;
        let a = mongodb::bson::to_vec(&doc! {"a": 1}).unwrap();
        let truncated = a[..a.len() - 2].to_vec();
        assert!(matches!(
            count_bson_docs_streaming(std::io::Cursor::new(truncated)),
            Err(AppError::Parse(_))
        ));
    }

    #[test]
    fn count_bson_docs_streaming_rejects_an_invalid_length_prefix() {
        // Length prefix (4) is smaller than the minimum possible BSON document (5: length + terminator).
        let bytes: Vec<u8> = vec![4, 0, 0, 0];
        assert!(matches!(
            count_bson_docs_streaming(std::io::Cursor::new(bytes)),
            Err(AppError::Parse(_))
        ));
    }

    #[test]
    fn count_bson_docs_streaming_rejects_a_truncated_trailing_length_prefix() {
        // 2 stray trailing bytes must error, not be silently treated as clean EOF.
        use mongodb::bson::doc;
        let mut buf = mongodb::bson::to_vec(&doc! {"a": 1}).unwrap();
        buf.extend_from_slice(&[0xAA, 0xBB]);
        assert!(matches!(
            count_bson_docs_streaming(std::io::Cursor::new(buf)),
            Err(AppError::Parse(_))
        ));
    }

    #[test]
    fn parsed_bson_docs_roundtrip_via_document_from_reader() {
        use mongodb::bson::doc;
        let a = mongodb::bson::to_vec(&doc! {"a": 1}).unwrap();
        let b = mongodb::bson::to_vec(&doc! {"b": 2}).unwrap();
        let mut buf = a.clone();
        buf.extend_from_slice(&b);
        let mut cursor: &[u8] = &buf;
        let first = Document::from_reader(&mut cursor).unwrap();
        let second = Document::from_reader(&mut cursor).unwrap();
        assert_eq!(first.get_i32("a").unwrap(), 1);
        assert_eq!(second.get_i32("b").unwrap(), 2);
        assert!(cursor.is_empty());
    }
}
