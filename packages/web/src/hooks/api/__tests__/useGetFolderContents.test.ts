import { renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";

const { getCanonicalFolder, getOpportunityDocuments } = vi.hoisted(() => ({
  getCanonicalFolder: vi.fn(),
  getOpportunityDocuments: vi.fn(),
}));

vi.mock("@/lib/eden", () => ({
  api: {
    core: {
      orgs: () => ({
        rooms: {
          folders: () => ({
            get: getCanonicalFolder,
          }),
        },
        opportunities: () => ({
          documents: {
            get: getOpportunityDocuments,
          },
        }),
      }),
    },
  },
}));

import { useGetFolderContents } from "../useGetFolderContents";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  getCanonicalFolder.mockReset();
  getOpportunityDocuments.mockReset();
});

describe("useGetFolderContents", () => {
  it("fetches a canonical folder's listing", async () => {
    getCanonicalFolder.mockResolvedValue({
      status: 200,
      data: { documents: [] },
    });

    const { result } = renderHook(
      () =>
        useGetFolderContents("org-1", {
          kind: "canonical",
          folder: "02_Financials",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(getCanonicalFolder).toHaveBeenCalled();
    expect(getOpportunityDocuments).not.toHaveBeenCalled();
    expect(result.current.listing?.documents).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it("fetches an opportunity's document listing", async () => {
    getOpportunityDocuments.mockResolvedValue({
      status: 200,
      data: { documents: [] },
    });

    const { result } = renderHook(
      () => useGetFolderContents("org-1", { kind: "opportunity", id: "opp-1" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(getOpportunityDocuments).toHaveBeenCalled();
    expect(getCanonicalFolder).not.toHaveBeenCalled();
    expect(result.current.listing?.documents).toEqual([]);
  });

  it("treats a non-200 response as an error without a listing", async () => {
    getCanonicalFolder.mockResolvedValue({
      status: 400,
      data: { ok: false, reason: "invalid_canonical_folder" },
    });

    const { result } = renderHook(
      () =>
        useGetFolderContents("org-1", {
          kind: "canonical",
          folder: "02_Financials",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.listing).toBeUndefined();
    expect(result.current.isError).toBe(true);
  });

  it("stays disabled when orgId or target is missing", () => {
    const { result } = renderHook(
      () => useGetFolderContents(undefined, undefined),
      { wrapper: createWrapper() },
    );

    expect(getCanonicalFolder).not.toHaveBeenCalled();
    expect(getOpportunityDocuments).not.toHaveBeenCalled();
    expect(result.current.status).toBe("pending");
  });
});
