export type ValidationResult = { ok: true } | { ok: false; error: string };

/** Kiểm cú pháp form connection: label & uri không rỗng, uri đúng scheme Mongo. */
export function validateConnection(label: string, uri: string): ValidationResult {
  if (label.trim() === "") return { ok: false, error: "Tên connection không được rỗng." };
  const u = uri.trim();
  if (u === "") return { ok: false, error: "URI không được rỗng." };
  if (!u.startsWith("mongodb://") && !u.startsWith("mongodb+srv://")) {
    return { ok: false, error: "URI phải bắt đầu bằng mongodb:// hoặc mongodb+srv://." };
  }
  return { ok: true };
}
