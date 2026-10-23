//! Field redaction for MCP results: values of fields whose name matches one of the user's patterns
//! are replaced with `"[redacted]"` at every depth before a document leaves the app.
//!
//! A pattern matches a whole field name, case-insensitively; `*` stands for any run of characters
//! (`*password*` catches `userPassword` and `password_hash`). Plain `password` matches only `password`.

use mongodb::bson::{Bson, Document};

pub const REDACTED: &str = "[redacted]";

/// Patterns used when the frontend sends none; mirrors `DEFAULT_REDACT_FIELDS` in `domain/mcp.ts`.
/// Wildcards catch the usual variants (`accessToken`, `clientSecret`, `passwordHash`, `userPassword`);
/// `ssn` stays exact because `*ssn*` would hide `className`.
pub const DEFAULT_REDACT_FIELDS: [&str; 8] =
    ["*password*", "*passwd*", "*secret*", "*token*", "*apikey*", "*api_key*", "*cardnumber*", "ssn"];

pub fn default_patterns() -> Vec<String> {
    DEFAULT_REDACT_FIELDS.iter().map(|s| s.to_string()).collect()
}

/// Case-insensitive whole-string match where `*` matches any (possibly empty) run of characters.
fn glob_match(pattern: &str, text: &str) -> bool {
    // Field names and patterns are almost always ASCII: match the bytes without allocating.
    if pattern.is_ascii() && text.is_ascii() {
        return glob_match_by(pattern.as_bytes(), text.as_bytes(), |a, b| a.eq_ignore_ascii_case(b), b'*');
    }
    let p: Vec<char> = pattern.to_lowercase().chars().collect();
    let t: Vec<char> = text.to_lowercase().chars().collect();
    glob_match_by(&p, &t, |a, b| a == b, '*')
}

fn glob_match_by<T: Copy + PartialEq>(p: &[T], t: &[T], eq: impl Fn(&T, &T) -> bool, star_sym: T) -> bool {
    let (mut pi, mut ti) = (0usize, 0usize);
    let (mut star, mut mark) = (None::<usize>, 0usize);
    while ti < t.len() {
        if pi < p.len() && p[pi] == star_sym {
            star = Some(pi);
            mark = ti;
            pi += 1;
        } else if pi < p.len() && eq(&p[pi], &t[ti]) {
            pi += 1;
            ti += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == star_sym {
        pi += 1;
    }
    pi == p.len()
}

pub fn field_matches(name: &str, patterns: &[String]) -> bool {
    patterns.iter().any(|p| !p.trim().is_empty() && glob_match(p.trim(), name))
}

fn redact_value(v: Bson, patterns: &[String]) -> Bson {
    match v {
        Bson::Document(d) => Bson::Document(redact_document(d, patterns)),
        Bson::Array(items) => Bson::Array(items.into_iter().map(|b| redact_value(b, patterns)).collect()),
        other => other,
    }
}

/// `d` with every matching field's value replaced, recursing through subdocuments and arrays.
pub fn redact_document(d: Document, patterns: &[String]) -> Document {
    if patterns.is_empty() {
        return d;
    }
    d.into_iter()
        .map(|(k, v)| {
            let v = if field_matches(&k, patterns) { Bson::String(REDACTED.into()) } else { redact_value(v, patterns) };
            (k, v)
        })
        .collect()
}

/// The first field name in a query document (a filter or sort, including dotted paths and nested
/// operators) that matches a pattern. Lets a model's filter be refused instead of used as an oracle
/// ("count the documents whose password starts with a…").
pub fn first_redacted_field(d: &Document, patterns: &[String]) -> Option<String> {
    if patterns.is_empty() {
        return None;
    }
    for (k, v) in d {
        if !k.starts_with('$') && k.split('.').any(|seg| field_matches(seg, patterns)) {
            return Some(k.clone());
        }
        let found = match v {
            Bson::Document(sub) => first_redacted_field(sub, patterns),
            Bson::Array(items) => items.iter().find_map(|b| b.as_document().and_then(|sub| first_redacted_field(sub, patterns))),
            _ => None,
        };
        if found.is_some() {
            return found;
        }
    }
    None
}

/// Like [`first_redacted_field`] for every stage of an aggregation pipeline, and also for field
/// references inside expressions (`"$password"`, `"$auth.token"`): `$group: {_id: "$password"}` or
/// `$project: {x: "$password"}` would otherwise read or copy a hidden value.
/// Limitation: indirect access (`$$ROOT`, `$getField` with a computed name, `$objectToArray`) is not
/// analysed, so a determined model can still reach a hidden field through an aggregation.
pub fn first_redacted_in_pipeline(stages: &[Document], patterns: &[String]) -> Option<String> {
    if patterns.is_empty() {
        return None;
    }
    stages.iter().find_map(|st| first_redacted_field(st, patterns).or_else(|| first_redacted_reference(&Bson::Document(st.clone()), patterns)))
}

fn first_redacted_reference(v: &Bson, patterns: &[String]) -> Option<String> {
    match v {
        Bson::String(s) => {
            let path = s.strip_prefix('$').filter(|p| !p.starts_with('$'))?;
            path.split('.').any(|seg| field_matches(seg, patterns)).then(|| s.clone())
        }
        Bson::Document(d) => d.values().find_map(|x| first_redacted_reference(x, patterns)),
        Bson::Array(a) => a.iter().find_map(|x| first_redacted_reference(x, patterns)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::doc;

    #[test]
    fn default_patterns_catch_common_secret_field_names() {
        let defaults = default_patterns();
        for name in ["accessToken", "refresh_token", "clientSecret", "passwordHash", "userPassword", "apiKey", "API_KEY", "cardNumber", "ssn", "passwd"] {
            let out = redact_document(doc! { name: "v", "className": "keep" }, &defaults);
            assert_eq!(out.get_str(name).unwrap(), REDACTED, "{name}");
            assert_eq!(out.get_str("className").unwrap(), "keep");
        }
    }

    #[test]
    fn pipeline_stages_and_field_references_are_checked() {
        let p = pats(&["*password*", "ssn"]);
        assert!(first_redacted_in_pipeline(&[doc! { "$match": { "userPassword": { "$gt": "a" } } }], &p).is_some());
        assert!(first_redacted_in_pipeline(&[doc! { "$group": { "_id": "$password", "n": { "$sum": 1 } } }], &p).is_some());
        assert!(first_redacted_in_pipeline(&[doc! { "$project": { "x": "$profile.ssn" } }], &p).is_some());
        assert!(first_redacted_in_pipeline(&[doc! { "$match": { "a": 1 } }, doc! { "$group": { "_id": "$city" } }], &p).is_none());
        assert!(first_redacted_in_pipeline(&[doc! { "$match": { "password": 1 } }], &[]).is_none());
    }

    fn pats(p: &[&str]) -> Vec<String> {
        p.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn redacts_nested_matching_fields() {
        let d = doc! {
            "name": "Ann",
            "Password": "hunter2",
            "profile": { "ApiKey": "k-1", "city": "Hue", "deep": { "SSN": "123", "keep": 1 } },
            "accounts": [ { "token": "t", "id": 7 }, { "id": 8 }, "plain" ],
        };
        let out = redact_document(d, &pats(&["password", "apiKey", "ssn", "token"]));
        assert_eq!(out.get_str("name").unwrap(), "Ann");
        assert_eq!(out.get_str("Password").unwrap(), REDACTED);
        let profile = out.get_document("profile").unwrap();
        assert_eq!(profile.get_str("ApiKey").unwrap(), REDACTED);
        assert_eq!(profile.get_str("city").unwrap(), "Hue");
        let deep = profile.get_document("deep").unwrap();
        assert_eq!((deep.get_str("SSN").unwrap(), deep.get_i32("keep").unwrap()), (REDACTED, 1));
        let accounts = out.get_array("accounts").unwrap();
        assert_eq!(accounts[0].as_document().unwrap().get_str("token").unwrap(), REDACTED);
        assert_eq!(accounts[0].as_document().unwrap().get_i32("id").unwrap(), 7);
        assert_eq!(accounts[2].as_str(), Some("plain"));
        // a matching field holding a whole subdocument is replaced as a unit
        let out = redact_document(doc! { "secret": { "a": 1 } }, &pats(&["secret"]));
        assert_eq!(out, doc! { "secret": REDACTED });
    }

    #[test]
    fn patterns_match_whole_names_with_wildcards() {
        assert!(field_matches("PASSWORD", &pats(&["password"])));
        assert!(!field_matches("userPassword", &pats(&["password"])));
        assert!(field_matches("userPassword", &pats(&["*password*"])));
        assert!(field_matches("password_hash", &pats(&["password*"])));
        assert!(!field_matches("className", &pats(&["ssn"])));
        assert!(!field_matches("anything", &pats(&[""])));
        assert!(!field_matches("anything", &[]));
    }

    #[test]
    fn empty_pattern_list_changes_nothing() {
        let d = doc! { "password": "x" };
        assert_eq!(redact_document(d.clone(), &[]), d);
    }

    #[test]
    fn filters_on_redacted_fields_are_found() {
        let p = pats(&["password", "token"]);
        assert_eq!(first_redacted_field(&doc! { "password": { "$regex": "^a" } }, &p).as_deref(), Some("password"));
        assert_eq!(first_redacted_field(&doc! { "$or": [ { "a": 1 }, { "auth.Token": "x" } ] }, &p).as_deref(), Some("auth.Token"));
        assert_eq!(first_redacted_field(&doc! { "name": "x", "age": { "$gt": 3 } }, &p), None);
        assert_eq!(first_redacted_field(&doc! { "password": 1 }, &[]), None);
    }
}
