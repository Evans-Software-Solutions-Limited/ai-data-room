// In-memory upload registry — room-and-folders (slice 2), T-014.
//
// Backs the `/room` upload modal's per-file progress list
// (`useUploadDocuments` + `UploadModal`).
//
// Reconciliation vs design.md's "in-memory upload registry for
// resume-on-tab-reload" language (flagged in the PR): a `File` handle is
// NOT serializable to any storage the browser exposes (localStorage,
// IndexedDB, etc. can hold bytes, but re-deriving a live `File` handle
// from them isn't how the platform works), so a genuine HARD page reload
// cannot resume an in-flight multipart PUT without the user re-selecting
// the file — there is nothing to resume from. This registry is therefore
// a module-level singleton (`uploadRegistry` below) that survives SPA
// navigation and component remounts — leaving the folder and coming back
// keeps the in-flight progress list intact — which is the correct,
// achievable reading of "resume-on-tab-reload" given the constraint.
//
// `useSyncExternalStore`-friendly: `getAll()` returns a referentially
// STABLE snapshot between notifications (React throws "The result of
// getSnapshot should be cached" otherwise) — the snapshot array is
// rebuilt only when a mutation actually happens, never on read.

export type UploadStatus =
  | "initiating"
  | "uploading"
  | "completing"
  | "done"
  | "error"
  | "canceled";

export interface UploadEntry {
  /** Client-generated id (`crypto.randomUUID()`). */
  id: string;
  fileName: string;
  sizeBytes: number;
  status: UploadStatus;
  bytesUploaded: number;
  /** Human-readable reason, set when `status === "error"`. */
  error?: string;
}

export interface UploadRegistry {
  register(entry: UploadEntry): void;
  update(id: string, patch: Partial<UploadEntry>): void;
  remove(id: string): void;
  get(id: string): UploadEntry | undefined;
  /** Stable snapshot — see the module header note on `useSyncExternalStore`. */
  getAll(): UploadEntry[];
  subscribe(listener: () => void): () => void;
}

export function createUploadRegistry(): UploadRegistry {
  const entries = new Map<string, UploadEntry>();
  const listeners = new Set<() => void>();
  let snapshot: UploadEntry[] = [];

  function notify(): void {
    // Rebuild the cached snapshot only on mutation, so `getAll()` can
    // return the SAME array reference across reads until something
    // actually changes.
    snapshot = Array.from(entries.values());
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    register(entry) {
      entries.set(entry.id, entry);
      notify();
    },
    update(id, patch) {
      const existing = entries.get(id);
      if (!existing) return;
      entries.set(id, { ...existing, ...patch });
      notify();
    },
    remove(id) {
      if (!entries.delete(id)) return;
      notify();
    },
    get(id) {
      return entries.get(id);
    },
    getAll() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// The module singleton the app uses (`useUploadDocuments`). Tests use a
// fresh `createUploadRegistry()` instance instead, so upload state from
// one test never leaks into another.
export const uploadRegistry = createUploadRegistry();
