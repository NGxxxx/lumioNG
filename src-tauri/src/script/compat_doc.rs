//! Keeps `docs/MONGOSH_COMPAT.md` in step with `prelude.js`: the method lists are parsed out of the
//! prelude and compared with the doc. Regenerate with
//! `UPDATE_COMPAT_DOC=1 cargo test --manifest-path src-tauri/Cargo.toml prelude_compat_doc_is_in_sync`.

const PRELUDE: &str = include_str!("prelude.js");

/// (heading, example prefix, prelude marker line that opens the section, indent of its method lines, closing line, minimum method count)
/// The minimum makes a parser broken by reformatting the prelude fail loudly instead of regenerating a near-empty doc.
const SECTIONS: &[(&str, &str, &str, usize, &str, usize)] = &[
    ("Collection", "db.<coll>.", "function makeColl(", 4, "}", 35),
    ("Database", "db.", "function makeDb(", 4, "  };", 35),
    ("Cursor", "<cursor>.", "class Cursor {", 2, "}", 10),
    ("Replica set (`rs`)", "rs.", "var rs = ", 2, "}, \"rs\");", 8),
    ("Sharding (`sh`)", "sh.", "var sh = ", 2, "}, \"sh\");", 10),
];

/// Method names declared at `indent` spaces between the `start` line and the `end` line of the prelude.
fn methods(start: &str, indent: usize, end: &str) -> Vec<String> {
    let mut lines = PRELUDE.lines().skip_while(|l| !l.starts_with(start));
    assert!(lines.next().is_some(), "prelude.js has no `{start}` line");
    let pad = " ".repeat(indent);
    let mut names: Vec<String> = Vec::new();
    for line in lines.take_while(|l| *l != end) {
        let Some(rest) = line.strip_prefix(pad.as_str()) else { continue };
        let ident: String = rest.chars().take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '$').collect();
        let after = &rest[ident.len()..];
        // `name(args) {` — a method declaration; skips calls, keywords, `constructor` and `_private` helpers.
        let declares_body = after.starts_with('(') && after.find(')').is_some_and(|i| after[i + 1..].trim_start().starts_with('{'));
        if ident.is_empty() || ident == "constructor" || ident.starts_with('_') || !declares_body {
            continue;
        }
        if !names.contains(&ident) {
            names.push(ident);
        }
    }
    names.sort();
    names
}

fn render() -> String {
    let mut out = String::from(
        "# mongosh compatibility\n\n\
LumioNG runs scripts in an embedded JavaScript engine with a mongosh-style shim. This page lists the methods the shim implements; \
calling any other method fails with `... is not supported in LumioNG (see Help → mongosh compatibility)`.\n\n\
<!-- Generated from src-tauri/src/script/prelude.js. Do not edit by hand: run\n\
     UPDATE_COMPAT_DOC=1 cargo test --manifest-path src-tauri/Cargo.toml prelude_compat_doc_is_in_sync -->\n\n\
Also available: `print()`, `printjson()`, `console.log/info/warn/error`, `load(\"saved query name\")` (runs a saved query in the same context, up to 8 levels deep), \
and the BSON helpers (`ObjectId`, `ISODate`, `NumberLong`, `NumberInt`, `NumberDecimal`, `UUID`, `BinData`, `Timestamp`, `MinKey`, `MaxKey`). \
Output is limited to 1,000 lines per second. `db.<name>` is shorthand for `db.getCollection(\"<name>\")`.\n",
    );
    for (heading, prefix, start, indent, end, min) in SECTIONS {
        out.push_str(&format!("\n## {heading}\n\n| Method | Status |\n| --- | --- |\n"));
        let found = methods(start, *indent, end);
        assert!(
            found.len() >= *min,
            "found only {} {heading} methods in prelude.js (expected at least {min}): the parser in compat_doc.rs no longer matches the prelude's layout",
            found.len()
        );
        for name in found {
            out.push_str(&format!("| `{prefix}{name}()` | Supported |\n"));
        }
    }
    out
}

#[test]
fn prelude_compat_doc_is_in_sync() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../docs/MONGOSH_COMPAT.md");
    let expected = render();
    if std::env::var_os("UPDATE_COMPAT_DOC").is_some() {
        std::fs::write(&path, &expected).expect("write docs/MONGOSH_COMPAT.md");
        return;
    }
    // Checkouts with CRLF line endings must not make the comparison fail.
    let actual = std::fs::read_to_string(&path).unwrap_or_default().replace("\r\n", "\n");
    assert!(
        actual == expected,
        "docs/MONGOSH_COMPAT.md is out of sync with src-tauri/src/script/prelude.js.\n\
         Regenerate it with:\n  UPDATE_COMPAT_DOC=1 cargo test --manifest-path src-tauri/Cargo.toml prelude_compat_doc_is_in_sync\n\
         and commit the result."
    );
}

#[test]
fn compat_comparison_ignores_crlf() {
    let crlf = render().replace('\n', "\r\n");
    assert_eq!(crlf.replace("\r\n", "\n"), render());
}

#[test]
fn compat_parser_finds_known_methods() {
    assert!(methods("function makeColl(", 4, "}").contains(&"findOne".to_string()));
    assert!(methods("class Cursor {", 2, "}").contains(&"hasNext".to_string()));
    assert!(!methods("class Cursor {", 2, "}").contains(&"constructor".to_string()));
    assert!(methods("var rs = ", 2, "}, \"rs\");").contains(&"stepDown".to_string()));
    assert!(methods("var sh = ", 2, "}, \"sh\");").contains(&"moveChunk".to_string()));
    assert!(methods("function makeDb(", 4, "  };").contains(&"getCollectionNames".to_string()));
    let cursor = methods("class Cursor {", 2, "}");
    for m in ["sort", "limit", "skip", "pretty"] {
        assert!(cursor.contains(&m.to_string()), "{m}");
    }
    assert!(!methods("function makeDb(", 4, "  };").contains(&"get".to_string()), "Proxy handler is not an API method");
}
