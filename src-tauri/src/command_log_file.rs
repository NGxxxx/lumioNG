//! Pure helpers for the optional on-disk command log: one human-readable file per UTC day, pruned by
//! age and total size.
use crate::bson_json::millis_to_iso8601;

const PREFIX: &str = "commands-";
const SUFFIX: &str = ".log";
const DAY_MS: i64 = 86_400_000;

/// `commands-YYYY-MM-DD.log` for the UTC day containing `ms`.
pub fn file_name_for(ms: i64) -> String {
    format!("{PREFIX}{}{SUFFIX}", &millis_to_iso8601(ms)[..10])
}

/// True for names this module writes (so pruning and reading never touch anything else).
pub fn is_log_file_name(name: &str) -> bool {
    let Some(date) = name.strip_prefix(PREFIX).and_then(|r| r.strip_suffix(SUFFIX)) else { return false };
    date.len() == 10 && date.bytes().enumerate().all(|(i, b)| if i == 4 || i == 7 { b == b'-' } else { b.is_ascii_digit() })
}

/// Log files to delete: older than `keep_days` (counting today), then the oldest beyond `max_total`
/// bytes. Today's file is never deleted. `files` are (name, size); others are ignored.
pub fn files_to_prune(files: &[(String, u64)], now_ms: i64, keep_days: i64, max_total: u64) -> Vec<String> {
    let today = file_name_for(now_ms);
    let cutoff = file_name_for(now_ms - (keep_days - 1) * DAY_MS);
    let mut logs: Vec<&(String, u64)> = files.iter().filter(|(n, _)| is_log_file_name(n)).collect();
    // Same fixed-width format, so name order is date order; newest first.
    logs.sort_by(|a, b| b.0.cmp(&a.0));
    let mut out = Vec::new();
    let mut total = 0u64;
    for (name, size) in logs {
        if *name == today {
            total += size;
            continue;
        }
        if *name < cutoff || total + size > max_total {
            out.push(name.clone());
        } else {
            total += size;
        }
    }
    out
}

/// The text block written for one command, and the byte offset of the command text inside it.
pub fn entry_block(header: &str, text: &str) -> (String, u64) {
    let head = format!("{header}\n");
    let offset = head.len() as u64;
    (format!("{head}{text}\n\n"), offset)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = DAY_MS;
    // 2024-03-10T12:00:00Z
    const NOW: i64 = 1_710_072_000_000;

    #[test]
    fn names_follow_the_utc_day() {
        assert_eq!(file_name_for(NOW), "commands-2024-03-10.log");
        assert_eq!(file_name_for(NOW - DAY), "commands-2024-03-09.log");
    }

    #[test]
    fn only_our_own_names_count_as_log_files() {
        assert!(is_log_file_name("commands-2024-03-10.log"));
        for bad in ["commands-2024-3-10.log", "commands-2024-03-10.txt", "other.log", "commands-../x.log", "commands-2024-03-1a.log"] {
            assert!(!is_log_file_name(bad), "{bad}");
        }
    }

    #[test]
    fn prunes_by_age_keeping_today() {
        let files: Vec<(String, u64)> = (0..10).map(|d| (file_name_for(NOW - d * DAY), 10)).collect();
        let mut gone = files_to_prune(&files, NOW, 7, u64::MAX);
        gone.sort();
        assert_eq!(gone, vec![file_name_for(NOW - 9 * DAY), file_name_for(NOW - 8 * DAY), file_name_for(NOW - 7 * DAY)]);
    }

    #[test]
    fn prunes_oldest_beyond_the_size_cap_but_never_today() {
        let files = vec![
            (file_name_for(NOW), 80),
            (file_name_for(NOW - DAY), 15),
            (file_name_for(NOW - 2 * DAY), 15),
            ("notes.txt".to_string(), 1000),
        ];
        assert_eq!(files_to_prune(&files, NOW, 7, 100), vec![file_name_for(NOW - 2 * DAY)]);
        // Even an oversized today file stays.
        assert_eq!(files_to_prune(&[(file_name_for(NOW), 500)], NOW, 7, 100), Vec::<String>::new());
    }

    #[test]
    fn entry_block_points_at_the_text() {
        let (block, offset) = entry_block("12:00:00 local (5 ms)", "db.x.find({ \"é\": 1 })");
        assert_eq!(&block.as_bytes()[offset as usize..offset as usize + "db.x.find({ \"é\": 1 })".len()], "db.x.find({ \"é\": 1 })".as_bytes());
        assert!(block.ends_with("\n\n"));
    }
}
