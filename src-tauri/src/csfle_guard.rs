//! Keeping CSFLE ciphertext intact on writes: the pure BSON walking behind the replace / update
//! guards in `commands::csfle` (no driver, no Tauri), so it is testable without libmongocrypt.
use mongodb::bson::{spec::BinarySubtype, Binary, Bson, Document};

/// Prefix of the error a replace returns when encrypted fields were edited to new plaintext values:
/// `csfle_plaintext_required:<path>,<path>`. The frontend re-asks (typed confirmation on PROD).
pub const PLAINTEXT_REQUIRED: &str = "csfle_plaintext_required:";

type Segs = Vec<String>;

fn walk(b: &Bson, path: &mut Segs, out: &mut Vec<(Segs, Binary)>) {
    match b {
        Bson::Binary(bin) if bin.subtype == BinarySubtype::Encrypted => out.push((path.clone(), bin.clone())),
        Bson::Document(d) => {
            for (k, v) in d {
                path.push(k.clone());
                walk(v, path, out);
                path.pop();
            }
        }
        Bson::Array(a) => {
            for (i, v) in a.iter().enumerate() {
                path.push(i.to_string());
                walk(v, path, out);
                path.pop();
            }
        }
        _ => {}
    }
}

/// Every BinData subtype 6 value in `doc`, with its path.
fn encrypted_values(doc: &Document) -> Vec<(Segs, Binary)> {
    let mut out = Vec::new();
    for (k, v) in doc {
        walk(v, &mut vec![k.clone()], &mut out);
    }
    out
}

/// Dotted paths (array elements by index) of the encrypted values in a raw (non-decrypted) document.
pub fn encrypted_paths(doc: &Document) -> Vec<String> {
    encrypted_values(doc).into_iter().map(|(p, _)| p.join(".")).collect()
}

fn get_at<'a>(doc: &'a Document, segs: &[String]) -> Option<&'a Bson> {
    let mut cur = doc.get(segs.first()?)?;
    for s in &segs[1..] {
        cur = match cur {
            Bson::Document(d) => d.get(s)?,
            Bson::Array(a) => a.get(s.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(cur)
}

fn set_at(doc: &mut Document, segs: &[String], value: Bson) {
    fn go(cur: &mut Bson, segs: &[String], value: Bson) {
        match (cur, segs) {
            (slot, []) => *slot = value,
            (Bson::Document(d), [first, rest @ ..]) => {
                if let Some(next) = d.get_mut(first) {
                    go(next, rest, value);
                }
            }
            (Bson::Array(a), [first, rest @ ..]) => {
                if let Some(next) = first.parse::<usize>().ok().and_then(|i| a.get_mut(i)) {
                    go(next, rest, value);
                }
            }
            _ => {}
        }
    }
    if let Some((first, rest)) = segs.split_first() {
        if let Some(slot) = doc.get_mut(first) {
            go(slot, rest, value);
        }
    }
}

fn is_cipher(b: &Bson) -> bool {
    matches!(b, Bson::Binary(x) if x.subtype == BinarySubtype::Encrypted)
}

/// Equality that treats NaN as equal to NaN (an untouched NaN double must not count as "changed").
fn same_value(a: &Bson, b: &Bson) -> bool {
    match (a, b) {
        (Bson::Double(x), Bson::Double(y)) => x == y || (x.is_nan() && y.is_nan()),
        (Bson::Document(x), Bson::Document(y)) => x.len() == y.len() && x.iter().zip(y.iter()).all(|((k1, v1), (k2, v2))| k1 == k2 && same_value(v1, v2)),
        (Bson::Array(x), Bson::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(v1, v2)| same_value(v1, v2)),
        _ => a == b,
    }
}

/// Whether `needle` appears anywhere in `doc` (any depth) as a plain, non-ciphertext value.
fn appears_as_plaintext(doc: &Document, needle: &Bson) -> bool {
    fn go(b: &Bson, needle: &Bson) -> bool {
        if is_cipher(b) {
            return false;
        }
        if same_value(b, needle) {
            return true;
        }
        match b {
            Bson::Document(d) => d.values().any(|v| go(v, needle)),
            Bson::Array(a) => a.iter().any(|v| go(v, needle)),
            _ => false,
        }
    }
    doc.values().any(|v| go(v, needle))
}

/// Whether judging the replacement needs the DECRYPTED stored document: only when some encrypted path
/// is not simply still ciphertext in `new_doc`. A document saved while decryption is unavailable (the
/// editor holds ciphertext only) therefore saves without ever contacting the key.
pub fn needs_decryption(new_doc: &Document, raw_old: &Document) -> bool {
    encrypted_values(raw_old).iter().any(|(segs, _)| !get_at(new_doc, segs).is_some_and(is_cipher))
}

/// Makes a replacement safe for a document that holds encrypted fields. The editor works on the
/// DECRYPTED view, so for every path that is ciphertext in `raw_old`:
/// * unchanged against `dec_old` -> the original ciphertext goes back in (nothing is re-encrypted or lost);
/// * already ciphertext in the replacement (re-encrypted in the editor) -> left as is;
/// * a different plaintext value -> refused unless the path is in `plaintext_ok` (the user confirmed storing it unencrypted);
/// * missing from the replacement: a real delete passes, but if its decrypted value shows up anywhere
///   else as plain text (renamed, moved into a subdocument, shifted array index) it is refused like a change;
/// * inside an array whose length changed -> refused (indexes shift, so ciphertext cannot be matched safely).
///
/// `Err` lists the encrypted paths that still need a decision.
pub fn restore_ciphertext(new_doc: &mut Document, raw_old: &Document, dec_old: &Document, plaintext_ok: &[String]) -> Result<(), Vec<String>> {
    let mut pending: Vec<String> = Vec::new();
    let refuse = |dotted: String, pending: &mut Vec<String>| {
        if !plaintext_ok.contains(&dotted) && !pending.contains(&dotted) {
            pending.push(dotted);
        }
    };
    let before = new_doc.clone();
    for (segs, cipher) in encrypted_values(raw_old) {
        let dotted = segs.join(".");
        // An array on the way whose length changed.
        for n in 1..segs.len() {
            let (Some(Bson::Array(old)), new) = (get_at(raw_old, &segs[..n]), get_at(&before, &segs[..n])) else { continue };
            if !matches!(new, Some(Bson::Array(a)) if a.len() == old.len()) {
                refuse(dotted.clone(), &mut pending);
            }
        }
        match get_at(&before, &segs) {
            Some(v) if is_cipher(v) => {}
            Some(v) if get_at(dec_old, &segs).is_some_and(|d| same_value(v, d)) => set_at(new_doc, &segs, Bson::Binary(cipher)),
            Some(_) => refuse(dotted, &mut pending),
            None => {
                if get_at(dec_old, &segs).is_some_and(|d| appears_as_plaintext(&before, d)) {
                    refuse(dotted, &mut pending);
                }
            }
        }
    }
    if pending.is_empty() { Ok(()) } else { Err(pending) }
}

/// Whether `doc` holds any BinData subtype 6 value.
pub fn has_encrypted_values(doc: &Document) -> bool {
    !encrypted_values(doc).is_empty()
}

// ---- partial updates ($set / $unset / $rename ...) -------------------------------------------------------

/// The field paths an update document touches: every key under a `$operator`, plus the new names of `$rename`.
fn update_targets(update: &Document) -> Vec<Segs> {
    let split = |p: &str| p.split('.').map(str::to_string).collect::<Segs>();
    let mut out = Vec::new();
    for (op, spec) in update {
        if !op.starts_with('$') {
            continue;
        }
        let Bson::Document(fields) = spec else { continue };
        for (path, v) in fields {
            out.push(split(path));
            if op == "$rename" {
                if let Bson::String(to) = v {
                    out.push(split(to));
                }
            }
        }
    }
    out
}

/// The encrypted paths of `raw_old` that `update` would touch: a target equal to, above (prefix of) or
/// below an encrypted path (`$` / numeric positional parts match any array index).
pub fn update_conflicts(update: &Document, raw_old: &Document) -> Vec<String> {
    let seg_eq = |a: &str, b: &str| a == b || a == "$" || a == "$[]" || a.starts_with("$[");
    let targets = update_targets(update);
    let mut out: Vec<String> = Vec::new();
    for (enc, _) in encrypted_values(raw_old) {
        let hit = targets.iter().any(|t| {
            let n = t.len().min(enc.len());
            t[..n].iter().zip(&enc[..n]).all(|(a, b)| seg_eq(a, b))
        });
        let dotted = enc.join(".");
        if hit && !out.contains(&dotted) {
            out.push(dotted);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- ciphertext preservation ----

    fn cipher(n: u8) -> Bson {
        Bson::Binary(Binary { subtype: BinarySubtype::Encrypted, bytes: vec![n; 20] })
    }

    #[test]
    fn finds_encrypted_paths_including_nested_and_array_values() {
        let d = mongodb::bson::doc! { "_id": 1, "ssn": cipher(1), "a": { "b": cipher(2), "plain": "x" }, "l": [ "p", cipher(3) ],
            "bin": Binary { subtype: BinarySubtype::Generic, bytes: vec![1] } };
        assert_eq!(encrypted_paths(&d), vec!["ssn", "a.b", "l.1"]);
    }

    #[test]
    fn unchanged_encrypted_fields_get_their_ciphertext_back() {
        let raw_old = mongodb::bson::doc! { "_id": 1, "name": "Ann", "ssn": cipher(1), "a": { "b": cipher(2) } };
        let dec_old = mongodb::bson::doc! { "_id": 1, "name": "Ann", "ssn": "123-45", "a": { "b": 7 } };
        // The editor changed only `name`.
        let mut new_doc = mongodb::bson::doc! { "_id": 1, "name": "Anna", "ssn": "123-45", "a": { "b": 7 } };
        restore_ciphertext(&mut new_doc, &raw_old, &dec_old, &[]).unwrap();
        assert_eq!(new_doc, mongodb::bson::doc! { "_id": 1, "name": "Anna", "ssn": cipher(1), "a": { "b": cipher(2) } });
    }

    #[test]
    fn a_changed_encrypted_value_needs_the_explicit_plaintext_flag() {
        let raw_old = mongodb::bson::doc! { "ssn": cipher(1), "pin": cipher(2) };
        let dec_old = mongodb::bson::doc! { "ssn": "123-45", "pin": "0000" };
        let edited = mongodb::bson::doc! { "ssn": "999-99", "pin": "0000" };
        let mut d = edited.clone();
        assert_eq!(restore_ciphertext(&mut d, &raw_old, &dec_old, &[]).unwrap_err(), vec!["ssn".to_string()]);
        // Confirming a different path is not enough.
        let mut d = edited.clone();
        assert!(restore_ciphertext(&mut d, &raw_old, &dec_old, &["pin".into()]).is_err());
        // With the flag the new plain text is kept and the untouched field still restored.
        let mut d = edited;
        restore_ciphertext(&mut d, &raw_old, &dec_old, &["ssn".into()]).unwrap();
        assert_eq!(d, mongodb::bson::doc! { "ssn": "999-99", "pin": cipher(2) });
    }

    #[test]
    fn re_encrypted_or_removed_fields_need_no_confirmation() {
        let raw_old = mongodb::bson::doc! { "ssn": cipher(1), "pin": cipher(2) };
        let dec_old = mongodb::bson::doc! { "ssn": "123-45", "pin": "0000" };
        let mut d = mongodb::bson::doc! { "ssn": cipher(9) };
        restore_ciphertext(&mut d, &raw_old, &dec_old, &[]).unwrap();
        assert_eq!(d, mongodb::bson::doc! { "ssn": cipher(9) });
    }

    #[test]
    fn a_renamed_or_moved_encrypted_value_is_not_treated_as_removed() {
        let raw_old = mongodb::bson::doc! { "ssn": cipher(1), "name": "Ann" };
        let dec_old = mongodb::bson::doc! { "ssn": "123-45", "name": "Ann" };
        // ssn -> ssn2 (rename in the editor)
        let mut d = mongodb::bson::doc! { "ssn2": "123-45", "name": "Ann" };
        assert_eq!(restore_ciphertext(&mut d, &raw_old, &dec_old, &[]).unwrap_err(), vec!["ssn".to_string()]);
        // moved into a subdocument
        let mut d = mongodb::bson::doc! { "info": { "ssn": "123-45" }, "name": "Ann" };
        assert_eq!(restore_ciphertext(&mut d, &raw_old, &dec_old, &[]).unwrap_err(), vec!["ssn".to_string()]);
        // the confirmation overrides the refusal
        let mut d = mongodb::bson::doc! { "ssn2": "123-45", "name": "Ann" };
        restore_ciphertext(&mut d, &raw_old, &dec_old, &["ssn".into()]).unwrap();
        // a plain delete (value nowhere else) still passes
        let mut d = mongodb::bson::doc! { "name": "Ann" };
        restore_ciphertext(&mut d, &raw_old, &dec_old, &[]).unwrap();
    }

    #[test]
    fn deleting_an_array_element_before_an_encrypted_one_is_refused() {
        let raw_old = mongodb::bson::doc! { "l": [ "a", cipher(1) ] };
        let dec_old = mongodb::bson::doc! { "l": [ "a", "secret" ] };
        // [a, secret] -> [secret]: the element shifted to index 0 as plain text, index 1 vanished.
        let mut d = mongodb::bson::doc! { "l": [ "secret" ] };
        assert_eq!(restore_ciphertext(&mut d, &raw_old, &dec_old, &[]).unwrap_err(), vec!["l.1".to_string()]);
        // Appending to the array also changes its length and is refused rather than guessed at.
        let mut d = mongodb::bson::doc! { "l": [ "a", "secret", "new" ] };
        assert_eq!(restore_ciphertext(&mut d, &raw_old, &dec_old, &[]).unwrap_err(), vec!["l.1".to_string()]);
        // Confirmed: the user accepts the plain text.
        let mut d = mongodb::bson::doc! { "l": [ "a", "secret", "new" ] };
        restore_ciphertext(&mut d, &raw_old, &dec_old, &["l.1".into()]).unwrap();
        // Same length, untouched: ciphertext restored.
        let mut d = mongodb::bson::doc! { "l": [ "b", "secret" ] };
        restore_ciphertext(&mut d, &raw_old, &dec_old, &[]).unwrap();
        assert_eq!(d, mongodb::bson::doc! { "l": [ "b", cipher(1) ] });
    }

    #[test]
    fn an_unchanged_nan_double_counts_as_unchanged() {
        let raw_old = mongodb::bson::doc! { "x": cipher(1) };
        let dec_old = mongodb::bson::doc! { "x": f64::NAN };
        let mut d = mongodb::bson::doc! { "x": f64::NAN };
        restore_ciphertext(&mut d, &raw_old, &dec_old, &[]).unwrap();
        assert_eq!(d, mongodb::bson::doc! { "x": cipher(1) });
    }

    #[test]
    fn a_ciphertext_only_document_needs_no_decryption_to_save() {
        let raw_old = mongodb::bson::doc! { "name": "Ann", "ssn": cipher(1), "a": { "b": cipher(2) } };
        // Saved while decryption is unavailable: the editor held the ciphertext untouched.
        let mut new_doc = mongodb::bson::doc! { "name": "Anna", "ssn": cipher(1), "a": { "b": cipher(2) } };
        assert!(!needs_decryption(&new_doc, &raw_old));
        restore_ciphertext(&mut new_doc, &raw_old, &Document::new(), &[]).unwrap();
        assert_eq!(new_doc.get_str("name").unwrap(), "Anna");
        // Any plaintext (or missing) encrypted path needs the decrypted original to be judged.
        assert!(needs_decryption(&mongodb::bson::doc! { "ssn": "x", "a": { "b": cipher(2) } }, &raw_old));
        assert!(needs_decryption(&mongodb::bson::doc! { "ssn": cipher(1) }, &raw_old));
    }

    #[test]
    fn partial_updates_may_not_touch_encrypted_fields_or_their_ancestors_and_descendants() {
        let raw_old = mongodb::bson::doc! { "_id": 1, "name": "Ann", "ssn": cipher(1), "a": { "b": cipher(2) }, "l": [ "x", cipher(3) ] };
        let hit = |u: Document| update_conflicts(&u, &raw_old);
        assert_eq!(hit(mongodb::bson::doc! { "$set": { "ssn": "999" } }), vec!["ssn"]);
        assert_eq!(hit(mongodb::bson::doc! { "$unset": { "ssn": "" } }), vec!["ssn"]);
        assert_eq!(hit(mongodb::bson::doc! { "$rename": { "ssn": "ssn2" } }), vec!["ssn"]);
        assert_eq!(hit(mongodb::bson::doc! { "$rename": { "name": "ssn" } }), vec!["ssn"], "renaming ONTO an encrypted field");
        assert_eq!(hit(mongodb::bson::doc! { "$set": { "a": { "b": 1 } } }), vec!["a.b"], "a prefix of an encrypted path");
        assert_eq!(hit(mongodb::bson::doc! { "$set": { "a.b.c": 1 } }), vec!["a.b"], "below an encrypted path");
        assert_eq!(hit(mongodb::bson::doc! { "$set": { "l.1": "z" } }), vec!["l.1"]);
        assert_eq!(hit(mongodb::bson::doc! { "$set": { "l.$": "z" } }), vec!["l.1"], "positional operator");
        assert_eq!(hit(mongodb::bson::doc! { "$set": { "l": [] } }), vec!["l.1"]);
        assert!(hit(mongodb::bson::doc! { "$set": { "name": "Anna", "l.0": "y", "a.other": 1, "ssn2": 1 } }).is_empty());
    }
}
