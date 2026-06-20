/** Số trang cho `total` bản ghi, mỗi trang `size`; tối thiểu 1 (kể cả khi rỗng). */
export function pageCount(total: number, size: number): number {
  if (size <= 0) return 1;
  return Math.max(1, Math.ceil(total / size));
}

/** Kẹp `page` (1-based) vào [1, count]; làm tròn xuống; giá trị không hợp lệ → 1. */
export function clampPage(page: number, count: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  if (page > count) return count;
  return Math.floor(page);
}

/** Số document bỏ qua để tới đầu trang `page` (1-based). */
export function skipFor(page: number, size: number): number {
  return Math.max(0, (page - 1) * size);
}
