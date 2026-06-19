/** Validate tên collection theo quy tắc Mongo (tập thực dụng). Trả message lỗi hoặc null. */
export function validateCollectionName(name: string): string | null {
  if (name.length === 0) return "Tên collection không được rỗng.";
  if (name.includes("$")) return "Tên collection không được chứa ký tự '$'.";
  if (name.startsWith("system.")) return "Tên collection không được bắt đầu bằng 'system.'.";
  if (name.includes("\0")) return "Tên collection không được chứa ký tự null.";
  if (new TextEncoder().encode(name).length > 235) return "Tên collection quá dài.";
  return null;
}

/** Validate tên database. Trả message lỗi hoặc null. */
export function validateDatabaseName(name: string): string | null {
  if (name.length === 0) return "Tên database không được rỗng.";
  if (/[\/\\. "$*<>:|?]/.test(name)) return "Tên database chứa ký tự không hợp lệ (/ \\ . \" $ * < > : | ? hoặc khoảng trắng).";
  if (new TextEncoder().encode(name).length > 63) return "Tên database quá dài (tối đa 63 byte).";
  return null;
}
