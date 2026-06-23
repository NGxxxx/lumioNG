/** Validate collection and database names against MongoDB naming rules. */

/** Returns a message key or null for the given collection name. */
export function validateCollectionName(name: string): string | null {
  if (name.length === 0) return "err_coll_name_empty";
  if (name.includes("$")) return "err_coll_name_dollar";
  if (name.startsWith("system.")) return "err_coll_name_system";
  if (name.includes("\0")) return "err_coll_name_null_char";
  if (new TextEncoder().encode(name).length > 235) return "err_coll_name_too_long";
  return null;
}

/** Validate a database name against MongoDB rules. Returns a message key or null. */
export function validateDatabaseName(name: string): string | null {
  if (name.length === 0) return "err_db_name_empty";
  if (/[\/\\. "$*<>:|?]/.test(name)) return "err_db_name_invalid_chars";
  if (new TextEncoder().encode(name).length > 63) return "err_db_name_too_long";
  return null;
}
