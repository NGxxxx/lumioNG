//! The structured result of one script Run, serialized to the frontend.
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ConsoleEntry {
    pub level: String, // "log" | "error"
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResultDisplay {
    /// Canonical ExtJSON rows for the grid.
    Docs { rows: Vec<String> },
    /// A pure find()/aggregate() cursor's query "recipe" — no rows materialized in QuickJS, the frontend pages it directly via `query_page`/`aggregate`.
    #[serde(rename_all = "camelCase")]
    CursorQuery {
        cursor_kind: String, // "find" | "agg"
        db: String,
        coll: String,
        query: String, // filter (find) or pipeline (agg), Canonical ExtJSON
        sort: Option<String>,
        projection: Option<String>,
        base_skip: i64,           // script's own .skip(n), if any
        fixed_limit: Option<i64>, // script's own .limit(n), if any — disables tab pager
    },
    /// A single non-doc value (scalar/object), Canonical ExtJSON.
    Value { json: String },
    /// A write acknowledgement (matched/modified/insertedId…), Canonical ExtJSON. (Slice 2.)
    Ack { json: String },
    /// Nothing to show in the result area.
    None,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Provenance {
    pub db: String,
    pub coll: String,
}

/// The originating query of the script's single constructed `Cursor`, if exactly one was
/// constructed during the run — independent of how the completion value was finalized (a pure
/// cursor recipe, a `.map()`/`.toArray()`'d array, a `.forEach()`'d `undefined`, etc). Lets Explain
/// work on scripts that transform a cursor's rows in JS, not just bare `find()`/`aggregate()`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExplainHint {
    pub cursor_kind: String, // "find" | "agg"
    pub db: String,
    pub coll: String,
    pub query: String,
    pub sort: Option<String>,
    pub projection: Option<String>,
    pub skip: i64,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScriptOutcome {
    pub console: Vec<ConsoleEntry>,
    pub result: ResultDisplay,
    pub provenance: Option<Provenance>,
    pub capped: bool,
    pub error: Option<String>,
    pub explain_hint: Option<ExplainHint>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_docs_result_with_camelcase_and_tag() {
        let o = ScriptOutcome {
            console: vec![ConsoleEntry { level: "log".into(), text: "hi".into() }],
            result: ResultDisplay::Docs { rows: vec![r#"{"a":1}"#.into()] },
            provenance: Some(Provenance { db: "d".into(), coll: "c".into() }),
            capped: true,
            error: None,
            explain_hint: None,
        };
        let j = serde_json::to_string(&o).unwrap();
        assert!(j.contains(r#""kind":"docs""#));
        assert!(j.contains(r#""capped":true"#));
        assert!(j.contains(r#""provenance":{"db":"d","coll":"c"}"#));
    }

    #[test]
    fn serializes_cursor_query_with_camelcase_fields() {
        let o = ScriptOutcome {
            console: vec![],
            result: ResultDisplay::CursorQuery {
                cursor_kind: "find".into(),
                db: "d".into(),
                coll: "c".into(),
                query: r#"{"a":1}"#.into(),
                sort: Some(r#"{"a":1}"#.into()),
                projection: None,
                base_skip: 10,
                fixed_limit: Some(5),
            },
            provenance: Some(Provenance { db: "d".into(), coll: "c".into() }),
            capped: false,
            error: None,
            explain_hint: None,
        };
        let j = serde_json::to_string(&o).unwrap();
        assert!(j.contains(r#""kind":"cursorQuery""#));
        assert!(j.contains(r#""cursorKind":"find""#));
        assert!(j.contains(r#""baseSkip":10"#));
        assert!(j.contains(r#""fixedLimit":5"#));
        assert!(j.contains(r#""projection":null"#));
    }

    #[test]
    fn serializes_explain_hint_with_camelcase_fields() {
        let o = ScriptOutcome {
            console: vec![],
            result: ResultDisplay::Docs { rows: vec![] },
            provenance: None,
            capped: false,
            error: None,
            explain_hint: Some(ExplainHint {
                cursor_kind: "find".into(),
                db: "d".into(),
                coll: "c".into(),
                query: r#"{"a":1}"#.into(),
                sort: None,
                projection: None,
                skip: 0,
                limit: None,
            }),
        };
        let j = serde_json::to_string(&o).unwrap();
        assert!(j.contains(r#""explainHint":{"cursorKind":"find""#));
    }
}
