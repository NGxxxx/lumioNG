use crate::error::AppError;
use mongodb::bson::{Bson, Document};

/// Parse a Canonical Extended JSON string into a BSON value (inverse of serialize).
pub fn canonical_string_to_bson(s: &str) -> Result<Bson, AppError> {
    let value: serde_json::Value =
        serde_json::from_str(s).map_err(|e| AppError::Parse(format!("invalid JSON: {e}")))?;
    Bson::try_from(value).map_err(|e| AppError::Parse(format!("invalid Extended JSON: {e}")))
}

/// Parse a Canonical Extended JSON string and require a top-level document.
pub fn canonical_string_to_doc(s: &str) -> Result<Document, AppError> {
    match canonical_string_to_bson(s)? {
        Bson::Document(d) => Ok(d),
        _ => Err(AppError::Parse("expected a JSON document at the top level".into())),
    }
}

/// Parse a Canonical Extended JSON **array** whose every element must be a document (`array_err`/`element_err` cover each failure case).
pub fn canonical_string_to_doc_array(
    s: &str,
    array_err: &str,
    element_err: &str,
) -> Result<Vec<Document>, AppError> {
    match canonical_string_to_bson(s)? {
        Bson::Array(arr) => arr
            .into_iter()
            .map(|b| {
                b.as_document()
                    .cloned()
                    .ok_or_else(|| AppError::Query(element_err.into()))
            })
            .collect(),
        _ => Err(AppError::Query(array_err.into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bson_json::doc_to_canonical_string;
    use mongodb::bson::spec::BinarySubtype;
    use mongodb::bson::{doc, oid::ObjectId, Binary, Bson, DateTime, Decimal128, Document, Regex, Timestamp};
    use std::str::FromStr;

    fn roundtrip(d: Document) {
        let s = doc_to_canonical_string(d.clone()).expect("serialize ok");
        let back = canonical_string_to_doc(&s).expect("parse ok");
        assert_eq!(back, d);
    }

    #[test]
    fn roundtrip_objectid() {
        roundtrip(doc! { "_id": ObjectId::from_str("507f1f77bcf86cd799439011").unwrap() });
    }
    #[test]
    fn roundtrip_numbers() {
        roundtrip(doc! { "i32": 42i32, "i64": 9_000_000_000i64, "f": 3.14f64 });
    }
    #[test]
    fn roundtrip_date() {
        roundtrip(doc! { "at": DateTime::from_millis(1_700_000_000_000) });
    }
    #[test]
    fn roundtrip_decimal128() {
        roundtrip(doc! { "price": Decimal128::from_str("123.45").unwrap() });
    }
    #[test]
    fn roundtrip_binary() {
        roundtrip(doc! { "blob": Binary { subtype: BinarySubtype::Generic, bytes: vec![1, 2, 3, 4] } });
    }
    #[test]
    fn roundtrip_null() {
        roundtrip(doc! { "n": Bson::Null });
    }
    #[test]
    fn roundtrip_bool() {
        roundtrip(doc! { "t": true, "f": false });
    }
    #[test]
    fn roundtrip_regex() {
        roundtrip(doc! { "re": Regex { pattern: "^a.*z$".into(), options: "im".into() } });
    }
    #[test]
    fn roundtrip_timestamp() {
        roundtrip(doc! { "ts": Timestamp { time: 1_700_000_000, increment: 5 } });
    }
    #[test]
    fn roundtrip_uuid_binary_subtype4() {
        roundtrip(doc! {
            "u": Binary { subtype: BinarySubtype::Uuid, bytes: vec![
                0x00,0x11,0x22,0x33,0x44,0x55,0x66,0x77,
                0x88,0x99,0xaa,0xbb,0xcc,0xdd,0xee,0xff,
            ] }
        });
    }
    #[test]
    fn roundtrip_int64_boundaries() {
        roundtrip(doc! { "min": i64::MIN, "max": i64::MAX });
    }
    #[test]
    fn roundtrip_nested_and_array() {
        roundtrip(doc! {
            "user": { "name": "a", "age": 30i32 },
            "tags": ["x", "y", "z"],
            "nums": [1i32, 2i32, 3i32]
        });
    }

    #[test]
    fn parse_id_value_objectid() {
        let b = canonical_string_to_bson("{\"$oid\":\"507f1f77bcf86cd799439011\"}").expect("parse ok");
        assert_eq!(b, Bson::ObjectId(ObjectId::from_str("507f1f77bcf86cd799439011").unwrap()));
    }

    #[test]
    fn invalid_syntax_is_parse_error() {
        let e = canonical_string_to_doc("{ broken").unwrap_err();
        assert!(matches!(e, AppError::Parse(_)));
    }

    #[test]
    fn top_level_non_document_is_parse_error() {
        let e = canonical_string_to_doc("42").unwrap_err();
        assert!(matches!(e, AppError::Parse(_)));
    }
}
