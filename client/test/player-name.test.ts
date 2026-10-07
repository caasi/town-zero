import { describe, it, expect } from "vitest";
import { loadPlayerName, savePlayerName, renameHintSeen, markRenameHintSeen } from "../src/player-name.js";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => { data.delete(k); },
    setItem: (k, v) => { data.set(k, v); },
  };
}

const throwing = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
} as unknown as Storage;

describe("loadPlayerName", () => {
  it("gives a new random name on a first visit and keeps it", () => {
    const storage = memoryStorage();
    const first = loadPlayerName(storage, () => 0);
    expect(first).toEqual({ name: "Quiet Otter", isNew: true });
    expect(loadPlayerName(storage, () => 0.5)).toEqual({ name: "Quiet Otter", isNew: false });
  });

  it("cleans a stored name, and replaces one that is not valid", () => {
    const storage = memoryStorage();
    savePlayerName(storage, "  Solid   Heron ");
    expect(loadPlayerName(storage).name).toBe("Solid Heron");
    storage.setItem("town-zero:name", "   ");
    expect(loadPlayerName(storage, () => 0)).toEqual({ name: "Quiet Otter", isNew: true });
  });

  it("still gives a name when the storage cannot be used (private mode, blocked)", () => {
    expect(loadPlayerName(throwing, () => 0)).toEqual({ name: "Quiet Otter", isNew: true });
    expect(() => savePlayerName(throwing, "Solid Heron")).not.toThrow();
  });
});

describe("rename hint", () => {
  it("is shown until it is marked as seen", () => {
    const storage = memoryStorage();
    expect(renameHintSeen(storage)).toBe(false);
    markRenameHintSeen(storage);
    expect(renameHintSeen(storage)).toBe(true);
  });

  it("counts as seen when the storage cannot be used, so it never nags", () => {
    expect(renameHintSeen(throwing)).toBe(true);
    expect(() => markRenameHintSeen(throwing)).not.toThrow();
  });
});
