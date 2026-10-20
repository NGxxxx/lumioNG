import { describe, it, expect } from "vitest";
import { migrateFromLocalStorage, MIGRATED_KEY } from "./prefsMigration";

function fakeStorage(data: Record<string, string>): Storage {
  const keys = Object.keys(data);
  return {
    get length() { return keys.length; },
    key: (i: number) => keys[i] ?? null,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem() {},
    removeItem() {},
    clear() {},
  } as Storage;
}

describe("migrateFromLocalStorage", () => {
  it("migrates_localstorage_once", () => {
    const ls = fakeStorage({ theme: "latte", "lumio.queryHistory.v1": "[1]" });
    const first = migrateFromLocalStorage(ls, {});
    expect(first.migrated).toBe(true);
    expect(first.entries).toEqual({ theme: "latte", "lumio.queryHistory.v1": "[1]", [MIGRATED_KEY]: "1" });
    const second = migrateFromLocalStorage(ls, first.entries);
    expect(second.migrated).toBe(false);
    expect(second.entries).toEqual(first.entries);
  });

  it("does_not_overwrite_existing_file_values", () => {
    const ls = fakeStorage({ theme: "latte", "ui-size": "large" });
    const { entries } = migrateFromLocalStorage(ls, { theme: "mocha" });
    expect(entries.theme).toBe("mocha");
    expect(entries["ui-size"]).toBe("large");
  });

  it("skips_when_already_migrated", () => {
    const existing = { [MIGRATED_KEY]: "1", theme: "mocha" };
    const r = migrateFromLocalStorage(fakeStorage({ theme: "latte", extra: "x" }), existing);
    expect(r.migrated).toBe(false);
    expect(r.entries).toEqual(existing);
  });

  it("leaves other apps' locale key behind and survives unreadable storage", () => {
    const r = migrateFromLocalStorage(fakeStorage({ PARAGLIDE_LOCALE: "vi", a: "1" }), {});
    expect(r.entries).toEqual({ a: "1", [MIGRATED_KEY]: "1" });
    const broken = { get length(): number { throw new Error("denied"); } } as unknown as Storage;
    expect(migrateFromLocalStorage(broken, {})).toEqual({ entries: {}, migrated: false });
  });
});
