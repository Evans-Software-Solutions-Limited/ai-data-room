import { renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";

const { postOpportunity, patchOpportunity, archiveOpportunityPost } =
  vi.hoisted(() => ({
    postOpportunity: vi.fn(),
    patchOpportunity: vi.fn(),
    archiveOpportunityPost: vi.fn(),
  }));

vi.mock("@/lib/eden", () => ({
  api: {
    core: {
      orgs: () => ({
        opportunities: Object.assign(
          () => ({
            patch: patchOpportunity,
            archive: { post: archiveOpportunityPost },
          }),
          { post: postOpportunity },
        ),
      }),
    },
  },
}));

import {
  OpportunityMutationError,
  useArchiveOpportunity,
  useCreateOpportunity,
  useRenameOpportunity,
} from "../useOpportunityMutations";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { wrapper, invalidateQueries };
}

beforeEach(() => {
  postOpportunity.mockReset();
  patchOpportunity.mockReset();
  archiveOpportunityPost.mockReset();
});

describe("useCreateOpportunity", () => {
  it("returns the created DTO and invalidates the room query on success", async () => {
    const dto = {
      id: "opp-1",
      slug: "Vendor_A",
      name: "Vendor A",
      status: "active" as const,
      createdAt: "2026-07-01T00:00:00.000Z",
    };
    postOpportunity.mockResolvedValue({ status: 201, data: dto });
    const { wrapper, invalidateQueries } = createWrapper();

    const { result } = renderHook(() => useCreateOpportunity("org-1"), {
      wrapper,
    });

    result.current.mutate({ slug: "Vendor_A" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(dto);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["room", "org-1"],
    });
  });

  it("throws OpportunityMutationError with reason slug_taken on a 409", async () => {
    postOpportunity.mockResolvedValue({
      status: 409,
      data: null,
      error: { status: 409, value: { ok: false, reason: "slug_taken" } },
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useCreateOpportunity("org-1"), {
      wrapper,
    });

    result.current.mutate({ slug: "Vendor_A" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(OpportunityMutationError);
    expect((result.current.error as OpportunityMutationError).reason).toBe(
      "slug_taken",
    );
  });

  it("converts a Date createdAt into an ISO string", async () => {
    // The handler's TS type says `createdAt: Date` (see the
    // reconciliation note in useOpportunityMutations.ts) — exercise that
    // branch directly rather than only the string-shaped mocks above.
    postOpportunity.mockResolvedValue({
      status: 201,
      data: {
        id: "opp-3",
        slug: "Vendor_D",
        name: "Vendor D",
        status: "active",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useCreateOpportunity("org-1"), {
      wrapper,
    });

    result.current.mutate({ slug: "Vendor_D" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.createdAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("falls back to reason unknown for an unrecognized error body", async () => {
    postOpportunity.mockResolvedValue({
      status: 500,
      data: { reason: "totally_unexpected" },
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useCreateOpportunity("org-1"), {
      wrapper,
    });

    result.current.mutate({ slug: "Vendor_A" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as OpportunityMutationError).reason).toBe(
      "unknown",
    );
  });
});

describe("useRenameOpportunity", () => {
  it("invalidates room AND folderContents on success", async () => {
    const dto = {
      id: "opp-1",
      slug: "Vendor_B",
      name: "Vendor B",
      status: "active" as const,
      createdAt: "2026-07-01T00:00:00.000Z",
    };
    patchOpportunity.mockResolvedValue({ status: 200, data: dto });
    const { wrapper, invalidateQueries } = createWrapper();

    const { result } = renderHook(() => useRenameOpportunity("org-1"), {
      wrapper,
    });

    result.current.mutate({ id: "opp-1", slug: "Vendor_B" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["room", "org-1"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["folderContents", "org-1"],
    });
  });

  it("throws OpportunityMutationError with reason not_found on a 404", async () => {
    patchOpportunity.mockResolvedValue({
      status: 404,
      data: null,
      error: { status: 404, value: { ok: false, reason: "not_found" } },
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useRenameOpportunity("org-1"), {
      wrapper,
    });

    result.current.mutate({ id: "opp-1", slug: "Vendor_B" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as OpportunityMutationError).reason).toBe(
      "not_found",
    );
  });
});

describe("useArchiveOpportunity", () => {
  it("invalidates room and folderContents on success", async () => {
    const dto = {
      id: "opp-1",
      slug: "Vendor_A",
      name: "Vendor A",
      status: "archived" as const,
      createdAt: "2026-07-01T00:00:00.000Z",
    };
    // `postArchiveOpportunityHandler` returns `archiveOpportunity`'s
    // `{ opportunity, grantsRevoked }` wrapper, not a bare opportunity —
    // see the reconciliation note in `useOpportunityMutations.ts`.
    archiveOpportunityPost.mockResolvedValue({
      status: 200,
      data: { opportunity: dto, grantsRevoked: 2 },
    });
    const { wrapper, invalidateQueries } = createWrapper();

    const { result } = renderHook(() => useArchiveOpportunity("org-1"), {
      wrapper,
    });

    result.current.mutate({ id: "opp-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(dto);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["room", "org-1"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["folderContents", "org-1"],
    });
  });

  it("throws OpportunityMutationError with reason already_archived on a 409", async () => {
    archiveOpportunityPost.mockResolvedValue({
      status: 409,
      data: null,
      error: {
        status: 409,
        value: { ok: false, reason: "already_archived" },
      },
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useArchiveOpportunity("org-1"), {
      wrapper,
    });

    result.current.mutate({ id: "opp-1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as OpportunityMutationError).reason).toBe(
      "already_archived",
    );
  });
});
