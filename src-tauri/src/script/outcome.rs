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

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScriptOutcome {
    pub console: Vec<ConsoleEntry>,
    pub result: ResultDisplay,
    pub provenance: Option<Provenance>,
    pub capped: bool,
    pub error: Option<String>,
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
        };
        let j = serde_json::to_string(&o).unwrap();
        assert!(j.contains(r#""kind":"docs""#));
        assert!(j.contains(r#""capped":true"#));
        assert!(j.contains(r#""provenance":{"db":"d","coll":"c"}"#));
    }
}
