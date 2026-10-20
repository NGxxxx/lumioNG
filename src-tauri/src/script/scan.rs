//! Best-effort static scan for destructive method calls; mirrors `src/lib/domain/scriptScan.ts` (`DESTRUCTIVE`, `stripComments`, `scanDestructive`).
//! Used by `load()` on PROD sessions: code pulled in from the saved-query library must have passed the user's confirmation.

/// Method names that mutate or destroy data (keep in step with the frontend list).
pub const DESTRUCTIVE: &[&str] = &[
    "updateOne", "updateMany", "update",
    "replaceOne", "replace",
    "deleteOne", "deleteMany", "remove",
    "bulkWrite",
    "findOneAndUpdate", "findOneAndReplace", "findOneAndDelete", "findAndModify",
    "dropIndexes", "dropIndex", "dropDatabase", "drop",
];

/// Blanks out `/* ... */` and `// ...` comments (like the frontend, without regard to string literals).
fn strip_comments(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let mut rest = src;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix("/*") {
            match after.find("*/") {
                Some(end) => {
                    out.push(' ');
                    rest = &after[end + 2..];
                }
                None => {
                    out.push_str(rest);
                    break;
                }
            }
        } else if let Some(after) = rest.strip_prefix("//") {
            out.push(' ');
            rest = after.find('\n').map_or("", |i| &after[i..]);
        } else {
            let c = rest.chars().next().unwrap_or(' ');
            out.push(c);
            rest = &rest[c.len_utf8()..];
        }
    }
    out
}

/// True when `code` contains `.name(` (whitespace allowed around the dot and before the paren) with `name` ending at a word boundary.
fn calls_method(code: &str, name: &str) -> bool {
    let bytes = code.as_bytes();
    let mut from = 0;
    while let Some(pos) = code[from..].find(name) {
        let start = from + pos;
        let end = start + name.len();
        from = start + 1;
        let before = code[..start].trim_end();
        let after = code[end..].trim_start();
        let word_end = bytes.get(end).is_none_or(|b| !(b.is_ascii_alphanumeric() || *b == b'_'));
        if before.ends_with('.') && after.starts_with('(') && word_end {
            return true;
        }
    }
    false
}

/// Distinct destructive method names invoked in `src`, in list order.
pub fn destructive_ops(src: &str) -> Vec<&'static str> {
    let code = strip_comments(src);
    DESTRUCTIVE.iter().copied().filter(|n| calls_method(&code, n)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_the_same_write_family_as_the_frontend() {
        assert_eq!(destructive_ops("db.c.deleteMany({})"), ["deleteMany"]);
        assert_eq!(destructive_ops("db.c . updateOne ({a:1},{$set:{b:1}}); db.c.drop()"), ["updateOne", "drop"]);
        for name in DESTRUCTIVE {
            assert_eq!(destructive_ops(&format!("db.c.{name}(x)")), [*name], "{name}");
        }
    }

    #[test]
    fn ignores_reads_inserts_comments_and_lookalikes() {
        assert!(destructive_ops("db.c.find({}); db.c.insertOne({a:1})").is_empty());
        assert!(destructive_ops("// db.c.deleteMany({})\n/* db.c.drop() */ db.c.find()").is_empty());
        assert!(destructive_ops("db.c.dropper()").is_empty(), "name must end at a word boundary");
        assert!(destructive_ops("var deleteMany = 1").is_empty(), "needs a method call");
        assert!(destructive_ops("db.c.updateX(1)").is_empty());
    }

    #[test]
    fn update_alone_does_not_hide_update_one() {
        assert_eq!(destructive_ops("db.c.updateOne({})"), ["updateOne"]);
    }
}
