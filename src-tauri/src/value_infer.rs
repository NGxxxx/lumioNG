//! Infers a BSON value from raw text found in a CSV cell or SQL string literal.
//! Shared by SQL import (`sql_import.rs`) and CSV import (`csv_import.rs`) so
//! both formats reconstruct nested objects/arrays and common scalar types the
//! same way instead of duplicating the logic.
use crate::json_bson::canonical_string_to_bson;
use mongodb::bson::{oid::ObjectId, Bson, DateTime};

/// Two independent toggles surfaced as checkboxes in the import dialog; both
/// default `true` at every call site that constructs one for a real import.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InferOptions {
    /// Text shaped like `{...}` or `[...]` is parsed as Canonical Extended
    /// JSON and, on success, used verbatim — this reconstructs nested
    /// objects/arrays/ObjectId/Date losslessly because it's the same text
    /// export already writes, not a heuristic.
    pub parse_json_like: bool,
    /// Non-JSON-looking text is tried against a fixed order of scalar
    /// heuristics (see `infer_scalar`) before falling back to a plain string.
    pub infer_scalars: bool,
}

/// Convert one cell/literal's raw text into the `Bson` value it most likely
/// represents, given the caller's `opts`. Never fails — worst case, returns
/// `Bson::String` with the original text untouched.
pub fn infer_bson(text: &str, opts: &InferOptions) -> Bson {
    let trimmed = text.trim();
    if opts.parse_json_like && (trimmed.starts_with('{') || trimmed.starts_with('[')) {
        if let Ok(b) = canonical_string_to_bson(trimmed) {
            return b;
        }
    }
    if opts.infer_scalars {
        if let Some(b) = infer_scalar(trimmed) {
            return b;
        }
    }
    Bson::String(text.to_string())
}

/// Short type label for one inferred `Bson` value, used by CSV's and SQL's preview commands to
/// annotate each column (`"int"`, `"double"`, `"bool"`, `"objectId"`, `"date"`, `"object"`,
/// `"array"`, `"null"`, or the `"string"` fallback).
pub fn bson_type_name(b: &Bson) -> &'static str {
    match b {
        Bson::Document(_) => "object",
        Bson::Array(_) => "array",
        Bson::Int32(_) | Bson::Int64(_) => "int",
        Bson::Double(_) => "double",
        Bson::Boolean(_) => "bool",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) => "date",
        Bson::Null => "null",
        _ => "string",
    }
}

/// Tries, in order, int64 → double → bool → ObjectId → ISO-8601 date;
/// `None` means "leave it as a string" (caller falls back to `Bson::String`).
fn infer_scalar(s: &str) -> Option<Bson> {
    if let Some(n) = parse_clean_int(s) {
        return Some(Bson::Int64(n));
    }
    if is_clean_double(s) {
        if let Ok(f) = s.parse::<f64>() {
            return Some(Bson::Double(f));
        }
    }
    match s.to_ascii_lowercase().as_str() {
        "true" => return Some(Bson::Boolean(true)),
        "false" => return Some(Bson::Boolean(false)),
        _ => {}
    }
    if is_object_id_hex(s) {
        if let Ok(oid) = ObjectId::parse_str(s) {
            return Some(Bson::ObjectId(oid));
        }
    }
    if let Ok(dt) = DateTime::parse_rfc3339_str(s) {
        return Some(Bson::DateTime(dt));
    }
    None
}

/// `s` (optionally `-`-prefixed) is all ASCII digits with no leading zero
/// (other than the single digit `"0"` itself) — a leading zero would be
/// silently dropped by round-tripping through `i64`, so that text is left as
/// a string on purpose.
fn parse_clean_int(s: &str) -> Option<i64> {
    let digits = s.strip_prefix('-').unwrap_or(s);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if digits.len() > 1 && digits.starts_with('0') {
        return None;
    }
    s.parse::<i64>().ok()
}

/// `s` matches `^-?\d+\.\d+$` — a non-empty all-digit integer part, a dot,
/// then a non-empty all-digit fractional part.
fn is_clean_double(s: &str) -> bool {
    let body = s.strip_prefix('-').unwrap_or(s);
    let Some((int_part, frac_part)) = body.split_once('.') else {
        return false;
    };
    !int_part.is_empty()
        && !frac_part.is_empty()
        && int_part.bytes().all(|b| b.is_ascii_digit())
        && frac_part.bytes().all(|b| b.is_ascii_digit())
}

/// Exactly 24 hex characters — `ObjectId`'s on-the-wire text length.
fn is_object_id_hex(s: &str) -> bool {
    s.len() == 24 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::Bson;

    fn opts(parse_json_like: bool, infer_scalars: bool) -> InferOptions {
        InferOptions { parse_json_like, infer_scalars }
    }

    #[test]
    fn json_like_object_reconstructs_nested_bson() {
        let out = infer_bson(r#"{"a":1,"b":{"c":2}}"#, &opts(true, true));
        match out {
            Bson::Document(d) => {
                assert_eq!(d.get_i32("a").unwrap(), 1);
                assert_eq!(d.get_document("b").unwrap().get_i32("c").unwrap(), 2);
            }
            other => panic!("expected a Document, got {other:?}"),
        }
    }

    #[test]
    fn json_like_object_with_extjson_oid_reconstructs_objectid() {
        let out = infer_bson(r#"{"$oid":"507f1f77bcf86cd799439011"}"#, &opts(true, true));
        assert!(matches!(out, Bson::ObjectId(_)));
    }

    #[test]
    fn json_like_array_reconstructs_bson_array() {
        let out = infer_bson("[1,2,3]", &opts(true, true));
        match out {
            Bson::Array(a) => assert_eq!(a.len(), 3),
            other => panic!("expected an Array, got {other:?}"),
        }
    }

    #[test]
    fn malformed_json_like_text_falls_back_to_string() {
        // starts with '{' but isn't valid JSON — must not error the whole row,
        // just fall back to treating it as a plain string.
        let out = infer_bson("{not valid json", &opts(true, true));
        assert_eq!(out, Bson::String("{not valid json".to_string()));
    }

    #[test]
    fn parse_json_like_off_keeps_object_shaped_text_as_string() {
        let out = infer_bson(r#"{"a":1}"#, &opts(false, true));
        assert_eq!(out, Bson::String(r#"{"a":1}"#.to_string()));
    }

    #[test]
    fn plain_text_with_all_flags_off_is_always_a_string() {
        let out = infer_bson("hello world", &opts(false, false));
        assert_eq!(out, Bson::String("hello world".to_string()));
    }

    #[test]
    fn plain_word_with_scalars_on_but_no_json_falls_back_to_string() {
        let out = infer_bson("hello world", &opts(true, true));
        assert_eq!(out, Bson::String("hello world".to_string()));
    }

    #[test]
    fn positive_integer_infers_as_int64() {
        assert_eq!(infer_bson("42", &opts(true, true)), Bson::Int64(42));
    }

    #[test]
    fn negative_integer_infers_as_int64() {
        assert_eq!(infer_bson("-42", &opts(true, true)), Bson::Int64(-42));
    }

    #[test]
    fn leading_zero_integer_stays_a_string() {
        // "00123" as a number would silently drop the leading zero on
        // reinsert — this is an intentional, spec-documented exception.
        assert_eq!(infer_bson("00123", &opts(true, true)), Bson::String("00123".to_string()));
    }

    #[test]
    fn single_zero_is_still_a_valid_integer() {
        assert_eq!(infer_bson("0", &opts(true, true)), Bson::Int64(0));
    }

    #[test]
    fn negative_double_infers_as_double() {
        assert_eq!(infer_bson("-3.14", &opts(true, true)), Bson::Double(-3.14));
    }

    #[test]
    fn double_missing_fractional_digits_stays_a_string() {
        // "123." doesn't match `^-?\d+\.\d+$` (needs at least one digit after the dot).
        assert_eq!(infer_bson("123.", &opts(true, true)), Bson::String("123.".to_string()));
    }

    #[test]
    fn bool_literals_are_case_insensitive() {
        assert_eq!(infer_bson("true", &opts(true, true)), Bson::Boolean(true));
        assert_eq!(infer_bson("FALSE", &opts(true, true)), Bson::Boolean(false));
        assert_eq!(infer_bson("True", &opts(true, true)), Bson::Boolean(true));
    }

    #[test]
    fn twenty_four_hex_chars_infers_as_object_id() {
        let out = infer_bson("507f1f77bcf86cd799439011", &opts(true, true));
        assert!(matches!(out, Bson::ObjectId(_)));
    }

    #[test]
    fn twenty_four_hex_chars_that_were_never_meant_as_an_object_id_still_becomes_one() {
        // Documented, accepted trade-off from the spec: there's no way to
        // distinguish "this text happens to be 24 hex chars" from "this is
        // really an ObjectId" using text alone.
        let out = infer_bson("abcdefabcdefabcdefabcdef", &opts(true, true));
        assert!(matches!(out, Bson::ObjectId(_)));
    }

    #[test]
    fn twenty_three_hex_chars_is_not_an_object_id() {
        let out = infer_bson("507f1f77bcf86cd79943901", &opts(true, true));
        assert_eq!(out, Bson::String("507f1f77bcf86cd79943901".to_string()));
    }

    #[test]
    fn valid_iso8601_date_infers_as_datetime() {
        let out = infer_bson("2024-01-15T10:30:00Z", &opts(true, true));
        assert!(matches!(out, Bson::DateTime(_)));
    }

    #[test]
    fn date_shaped_but_invalid_string_stays_a_string() {
        // Invalid month/day/hour — shaped like a date but not a real one.
        let out = infer_bson("2024-13-45T99:99:99Z", &opts(true, true));
        assert_eq!(out, Bson::String("2024-13-45T99:99:99Z".to_string()));
    }

    #[test]
    fn infer_scalars_off_keeps_numbers_and_bools_as_strings() {
        assert_eq!(infer_bson("42", &opts(true, false)), Bson::String("42".to_string()));
        assert_eq!(infer_bson("true", &opts(true, false)), Bson::String("true".to_string()));
    }

    #[test]
    fn bson_type_name_covers_every_inferable_type() {
        assert_eq!(bson_type_name(&Bson::String("x".into())), "string");
        assert_eq!(bson_type_name(&Bson::Int64(1)), "int");
        assert_eq!(bson_type_name(&Bson::Double(1.5)), "double");
        assert_eq!(bson_type_name(&Bson::Boolean(true)), "bool");
        assert_eq!(bson_type_name(&Bson::Null), "null");
        assert!(matches!(bson_type_name(&Bson::Array(vec![])), "array"));
    }
}
