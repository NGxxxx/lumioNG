use crate::error::AppError;
use mongodb::bson::{Bson, Document};

/// Serialize a Document to a Canonical Extended JSON string (lossless).
pub fn doc_to_canonical_string(doc: &Document) -> Result<String, AppError> {
    let value = Bson::Document(doc.clone()).into_canonical_extjson();
    serde_json::to_string(&value).map_err(|e| AppError::Serialize(e.to_string()))
}

/// Serialize a single BSON value to a Canonical Extended JSON string.
pub fn bson_to_canonical_string(value: &Bson) -> Result<String, AppError> {
    let v = value.clone().into_canonical_extjson();
    serde_json::to_string(&v).map_err(|e| AppError::Serialize(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{doc, oid::ObjectId, DateTime, Decimal128, Binary, Bson};
    use mongodb::bson::spec::BinarySubtype;
    use std::str::FromStr;

    fn roundtrip(doc: mongodb::bson::Document) {
        let s = doc_to_canonical_string(&doc).expect("serialize ok");
        let value: serde_json::Value = serde_json::from_str(&s).expect("valid json");
        let parsed = Bson::try_from(value).expect("parse extjson");
        assert_eq!(parsed, Bson::Document(doc));
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
        roundtrip(doc! { "blob": Binary { subtype: BinarySubtype::Generic, bytes: vec![1,2,3,4] } });
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
    fn bson_value_roundtrips() {
        let oid = ObjectId::from_str("507f1f77bcf86cd799439011").unwrap();
        let s = bson_to_canonical_string(&Bson::ObjectId(oid)).unwrap();
        let value: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(Bson::try_from(value).unwrap(), Bson::ObjectId(oid));
    }

    #[test]
    fn numbers_keep_type_in_canonical() {
        let doc = doc! { "i32": 42i32, "i64": 42i64, "f": 42f64 };
        let s = doc_to_canonical_string(&doc).unwrap();
        assert!(s.contains("$numberInt"), "i32 phải là $numberInt: {s}");
        assert!(s.contains("$numberLong"), "i64 phải là $numberLong: {s}");
        assert!(s.contains("$numberDouble"), "f64 phải là $numberDouble: {s}");
    }
}
