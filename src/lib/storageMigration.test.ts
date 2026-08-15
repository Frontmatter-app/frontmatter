import { beforeEach, describe, expect, it } from "vitest";
import { migrateLocalStorageKeys } from "./storageMigration";

/** A Storage that behaves like the real one, including index ordering. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  } as Storage;
}

const snapshot = (storage: Storage): Record<string, string> => {
  const out: Record<string, string> = {};
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)!;
    out[key] = storage.getItem(key)!;
  }
  return out;
};

describe("migrateLocalStorageKeys", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = fakeStorage({
      marktype_settings: '{"fontSize":"18px"}',
      marktype_saved_accounts: '[{"id":"a"}]',
      marktype_account_tokens: '{"a":"token"}',
      marktype_custom_theme: '{"bg":"#fff"}',
      unrelated_key: "left alone",
    });
  });

  it("carries every namespaced key across", () => {
    migrateLocalStorageKeys(storage);
    expect(storage.getItem("frontmatter_settings")).toBe('{"fontSize":"18px"}');
    expect(storage.getItem("frontmatter_saved_accounts")).toBe('[{"id":"a"}]');
    expect(storage.getItem("frontmatter_account_tokens")).toBe('{"a":"token"}');
    expect(storage.getItem("frontmatter_custom_theme")).toBe('{"bg":"#fff"}');
  });

  it("does not sign the user out or reset their settings", () => {
    const before = snapshot(storage);
    migrateLocalStorageKeys(storage);
    for (const [key, value] of Object.entries(before)) {
      const migrated = key.startsWith("marktype_")
        ? `frontmatter_${key.slice("marktype_".length)}`
        : key;
      expect(storage.getItem(migrated)).toBe(value);
    }
  });

  it("removes the old keys once they are copied", () => {
    migrateLocalStorageKeys(storage);
    expect(storage.getItem("marktype_settings")).toBeNull();
    expect(storage.getItem("marktype_saved_accounts")).toBeNull();
  });

  it("leaves keys from other namespaces alone", () => {
    migrateLocalStorageKeys(storage);
    expect(storage.getItem("unrelated_key")).toBe("left alone");
  });

  it("reports what it moved", () => {
    const result = migrateLocalStorageKeys(storage);
    expect(result.migrated).toContain("frontmatter_settings");
    expect(result.migrated).toHaveLength(4);
  });

  it("keeps the newer value when both names exist", () => {
    storage.setItem("frontmatter_settings", '{"fontSize":"20px"}');
    migrateLocalStorageKeys(storage);
    expect(storage.getItem("frontmatter_settings")).toBe('{"fontSize":"20px"}');
    expect(storage.getItem("marktype_settings")).toBeNull();
  });

  it("runs once, then costs a single read", () => {
    migrateLocalStorageKeys(storage);
    storage.setItem("marktype_settings", "stale value written later");
    const second = migrateLocalStorageKeys(storage);
    expect(second.migrated).toEqual([]);
    expect(storage.getItem("marktype_settings")).toBe("stale value written later");
  });

  it("is a no-op on a fresh install", () => {
    const fresh = fakeStorage();
    const result = migrateLocalStorageKeys(fresh);
    expect(result.migrated).toEqual([]);
  });

  it("resumes next launch if writing fails part-way", () => {
    const failing = fakeStorage({ marktype_settings: "value" });
    const realSet = failing.setItem.bind(failing);
    failing.setItem = (key: string, value: string) => {
      if (key.startsWith("frontmatter_") && key !== "frontmatter_storage_migrated") {
        throw new Error("quota exceeded");
      }
      realSet(key, value);
    };

    const result = migrateLocalStorageKeys(failing);
    expect(result.skipped).toContain("marktype_settings");
    // The value the write failed on is still there to try again.
    expect(failing.getItem("marktype_settings")).toBe("value");
  });
});
