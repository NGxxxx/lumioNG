use crate::error::AppError;
use mongodb::bson::{Bson, Document};

/// Serialize a Document to a Canonical Extended JSON string (lossless); takes it by value so cursor-loop callers can move each doc in instead of deep-cloning it.
pub fn doc_to_canonical_string(doc: Document) -> Result<String, AppError> {
    let value = Bson::Document(doc).into_canonical_extjson();
    serde_json::to_string(&value).map_err(|e| AppError::Serialize(e.to_string()))
}

/// Serialize a single BSON value to a Canonical Extended JSON string.
pub fn bson_to_canonical_string(value: &Bson) -> Result<String, AppError> {
    let v = value.clone().into_canonical_extjson();
    serde_json::to_string(&v).map_err(|e| AppError::Serialize(e.to_string()))
}

/// Type tag + display text for one BSON value (CSV/SQL cell formatting); Binary is a summary, object/array get full canonical JSON.
pub fn describe_bson(b: &Bson) -> (&'static str, String) {
    match b {
        Bson::Null => ("null", "null".to_string()),
        Bson::String(s) => ("string", s.clone()),
        Bson::Boolean(v) => ("bool", v.to_string()),
        Bson::Int32(_) => ("int", extjson_wrapper_string(b, "$numberInt")),
        Bson::Int64(_) => ("long", extjson_wrapper_string(b, "$numberLong")),
        Bson::Double(_) => ("double", extjson_wrapper_string(b, "$numberDouble")),
        Bson::Decimal128(_) => ("decimal", extjson_wrapper_string(b, "$numberDecimal")),
        Bson::ObjectId(_) => ("objectId", extjson_wrapper_string(b, "$oid")),
        Bson::DateTime(dt) => ("date", millis_to_iso8601(dt.timestamp_millis())),
        Bson::Binary(_) => ("binary", binary_display(b)),
        Bson::Array(_) => ("array", bson_to_canonical_string(b).unwrap_or_default()),
        _ => ("object", bson_to_canonical_string(b).unwrap_or_default()),
    }
}

/// Pulls one canonical-ExtJSON wrapper key's string value out of `b` (e.g. `$oid`, `$numberLong`).
fn extjson_wrapper_string(b: &Bson, key: &str) -> String {
    b.clone()
        .into_canonical_extjson()
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

/// Extracts base64 length from a Binary value's canonical ExtJSON representation, returning e.g. "Binary(4 b64 chars)".
fn binary_display(b: &Bson) -> String {
    let extjson = b.clone().into_canonical_extjson();
    let len = extjson
        .get("$binary")
        .and_then(|binary_obj| binary_obj.get("base64"))
        .and_then(|base64_val| base64_val.as_str())
        .map(|s| s.len())
        .unwrap_or(0);
    format!("Binary({len} b64 chars)")
}

/// Formats a Unix millisecond timestamp as `Date.prototype.toISOString()` would (hand-rolled since `DateTime::try_to_rfc3339_string()` omits sub-second zeros).
fn millis_to_iso8601(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let ms_of_day = ms.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    let hour = ms_of_day / 3_600_000;
    let minute = (ms_of_day / 60_000) % 60;
    let second = (ms_of_day / 1000) % 60;
    let millis = ms_of_day % 1000;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

/// Converts a day count since the Unix epoch to (year, month, day) — Howard Hinnant's `civil_from_days` algorithm, handles pre-1970 dates.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32; // [1, 12]
    let year = if m <= 2 { y + 1 } else { y };
    (year, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{doc, oid::ObjectId, DateTime, Decimal128, Binary, Bson, Regex, Timestamp};
    use mongodb::bson::spec::BinarySubtype;
    use std::str::FromStr;

    fn roundtrip(doc: mongodb::bson::Document) {
        let s = doc_to_canonical_string(doc.clone()).expect("serialize ok");
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
    fn bson_value_roundtrips() {
        let oid = ObjectId::from_str("507f1f77bcf86cd799439011").unwrap();
        let s = bson_to_canonical_string(&Bson::ObjectId(oid)).unwrap();
        let value: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(Bson::try_from(value).unwrap(), Bson::ObjectId(oid));
    }

    #[test]
    fn numbers_keep_type_in_canonical() {
        let doc = doc! { "i32": 42i32, "i64": 42i64, "f": 42f64 };
        let s = doc_to_canonical_string(doc).unwrap();
        assert!(s.contains("$numberInt"), "i32 must serialize as $numberInt: {s}");
        assert!(s.contains("$numberLong"), "i64 must serialize as $numberLong: {s}");
        assert!(s.contains("$numberDouble"), "f64 must serialize as $numberDouble: {s}");
    }

    #[test]
    fn describe_bson_null_string_bool() {
        assert_eq!(describe_bson(&Bson::Null), ("null", "null".to_string()));
        assert_eq!(describe_bson(&Bson::String("hi".into())), ("string", "hi".to_string()));
        assert_eq!(describe_bson(&Bson::Boolean(true)), ("bool", "true".to_string()));
        assert_eq!(describe_bson(&Bson::Boolean(false)), ("bool", "false".to_string()));
    }

    #[test]
    fn describe_bson_int32_and_int64() {
        assert_eq!(describe_bson(&Bson::Int32(5)), ("int", "5".to_string()));
        assert_eq!(describe_bson(&Bson::Int32(-5)), ("int", "-5".to_string()));
        assert_eq!(describe_bson(&Bson::Int64(9_000_000_000)), ("long", "9000000000".to_string()));
    }

    #[test]
    fn describe_bson_double_normal_and_whole_number() {
        // A fractional double's canonical text is its plain digits.
        assert_eq!(describe_bson(&Bson::Double(3.14)), ("double", "3.14".to_string()));
        // A whole-number double's canonical text always keeps a forced ".0" — into_canonical_extjson's own rule, not added here.
        assert_eq!(describe_bson(&Bson::Double(2.0)), ("double", "2.0".to_string()));
    }

    #[test]
    fn describe_bson_double_non_finite() {
        assert_eq!(describe_bson(&Bson::Double(f64::NAN)), ("double", "NaN".to_string()));
        assert_eq!(describe_bson(&Bson::Double(f64::INFINITY)), ("double", "Infinity".to_string()));
        assert_eq!(describe_bson(&Bson::Double(f64::NEG_INFINITY)), ("double", "-Infinity".to_string()));
    }

    #[test]
    fn describe_bson_decimal128() {
        let d = Decimal128::from_str("123.45").unwrap();
        assert_eq!(describe_bson(&Bson::Decimal128(d)), ("decimal", "123.45".to_string()));
    }

    #[test]
    fn describe_bson_object_id() {
        let oid = ObjectId::from_str("507f1f77bcf86cd799439011").unwrap();
        assert_eq!(describe_bson(&Bson::ObjectId(oid)), ("objectId", "507f1f77bcf86cd799439011".to_string()));
    }

    #[test]
    fn describe_bson_date_epoch_and_known_reference_points() {
        assert_eq!(
            describe_bson(&Bson::DateTime(DateTime::from_millis(0))),
            ("date", "1970-01-01T00:00:00.000Z".to_string())
        );
        // 2000-01-01T00:00:00Z, a well-known reference constant (946684800s) that also exercises
        // the algorithm's century/leap-year branch.
        assert_eq!(
            describe_bson(&Bson::DateTime(DateTime::from_millis(946_684_800_000))),
            ("date", "2000-01-01T00:00:00.000Z".to_string())
        );
        // 2024-01-01T00:00:00Z (1704067200s), a leap year.
        assert_eq!(
            describe_bson(&Bson::DateTime(DateTime::from_millis(1_704_067_200_000))),
            ("date", "2024-01-01T00:00:00.000Z".to_string())
        );
    }

    #[test]
    fn describe_bson_date_with_millis_and_pre_epoch() {
        assert_eq!(
            describe_bson(&Bson::DateTime(DateTime::from_millis(1_700_000_000_123))),
            ("date", "2023-11-14T22:13:20.123Z".to_string())
        );
        // One day before the epoch -- exercises civil_from_days's negative-input branch.
        assert_eq!(
            describe_bson(&Bson::DateTime(DateTime::from_millis(-86_400_000))),
            ("date", "1969-12-31T00:00:00.000Z".to_string())
        );
    }

    #[test]
    fn describe_bson_array_and_document() {
        assert_eq!(describe_bson(&Bson::Array(vec![])), ("array", "[]".to_string()));
        assert_eq!(
            describe_bson(&Bson::Array(vec![Bson::Int32(1), Bson::Int32(2)])),
            ("array", "[{\"$numberInt\":\"1\"},{\"$numberInt\":\"2\"}]".to_string())
        );
        assert_eq!(describe_bson(&Bson::Document(doc! {})), ("object", "{}".to_string()));
        assert_eq!(
            describe_bson(&Bson::Document(doc! { "a": 1i32 })),
            ("object", "{\"a\":{\"$numberInt\":\"1\"}}".to_string())
        );
    }

    #[test]
    fn describe_bson_binary_is_a_summary_not_full_json() {
        // Binary values are summarized as "Binary(N b64 chars)", not the full canonical JSON.
        // 3 raw bytes encode to exactly 4 base64 characters (3 % 3 == 0, no padding needed).
        let b = Bson::Binary(Binary { subtype: mongodb::bson::spec::BinarySubtype::Generic, bytes: vec![1, 2, 3] });
        assert_eq!(describe_bson(&b), ("binary", "Binary(4 b64 chars)".to_string()));
    }
}
