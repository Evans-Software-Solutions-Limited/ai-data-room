import { vi } from "vitest";

import { createUploadRegistry, type UploadEntry } from "../uploadRegistry";

function makeEntry(overrides: Partial<UploadEntry> = {}): UploadEntry {
  return {
    id: "upload-1",
    fileName: "Term Sheet.pdf",
    sizeBytes: 2048,
    status: "initiating",
    bytesUploaded: 0,
    ...overrides,
  };
}

describe("createUploadRegistry", () => {
  it("registers an entry and returns it via get/getAll", () => {
    const registry = createUploadRegistry();
    const entry = makeEntry();

    registry.register(entry);

    expect(registry.get("upload-1")).toEqual(entry);
    expect(registry.getAll()).toEqual([entry]);
  });

  it("returns undefined from get for an unknown id", () => {
    const registry = createUploadRegistry();

    expect(registry.get("nope")).toBeUndefined();
  });

  it("update() merges a patch into the existing entry", () => {
    const registry = createUploadRegistry();
    registry.register(makeEntry());

    registry.update("upload-1", { status: "uploading", bytesUploaded: 1024 });

    expect(registry.get("upload-1")).toEqual(
      makeEntry({ status: "uploading", bytesUploaded: 1024 }),
    );
  });

  it("update() is a no-op for an unknown id", () => {
    const registry = createUploadRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);

    registry.update("nope", { status: "done" });

    expect(registry.get("nope")).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it("remove() deletes an entry", () => {
    const registry = createUploadRegistry();
    registry.register(makeEntry());

    registry.remove("upload-1");

    expect(registry.get("upload-1")).toBeUndefined();
    expect(registry.getAll()).toEqual([]);
  });

  it("remove() is a no-op for an unknown id", () => {
    const registry = createUploadRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);

    registry.remove("nope");

    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies subscribers on register, update, and remove", () => {
    const registry = createUploadRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);

    registry.register(makeEntry());
    expect(listener).toHaveBeenCalledTimes(1);

    registry.update("upload-1", { status: "done" });
    expect(listener).toHaveBeenCalledTimes(2);

    registry.remove("upload-1");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("stops notifying after unsubscribe", () => {
    const registry = createUploadRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);

    unsubscribe();
    registry.register(makeEntry());

    expect(listener).not.toHaveBeenCalled();
  });

  it("getAll() returns a referentially stable snapshot until a mutation happens", () => {
    const registry = createUploadRegistry();
    registry.register(makeEntry());

    const first = registry.getAll();
    const second = registry.getAll();
    expect(second).toBe(first);

    registry.update("upload-1", { bytesUploaded: 512 });
    const third = registry.getAll();
    expect(third).not.toBe(first);

    const fourth = registry.getAll();
    expect(fourth).toBe(third);
  });
});
