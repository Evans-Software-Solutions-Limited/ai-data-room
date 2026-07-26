import { render, screen, fireEvent, within } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRouter } from "react-router";
import { CANONICAL_FOLDERS } from "@ai-data-room/api-utils/schemas/rooms";
import type {
  DocumentDTO,
  OpportunityDTO,
  RoomDTO,
} from "@ai-data-room/api-utils/schemas/rooms";

import Room from "../Room";
import { useGetCurrentUser } from "@/hooks/api/useGetCurrentUser";
import { useGetRoom } from "@/hooks/api/useGetRoom";
import { useGetFolderContents } from "@/hooks/api/useGetFolderContents";
import type { FolderTarget } from "@/hooks/api/useGetFolderContents";
import { useUploadDocuments } from "@/hooks/api/useUploadDocuments";
import {
  OpportunityMutationError,
  useArchiveOpportunity,
  useCreateOpportunity,
  useRenameOpportunity,
} from "@/hooks/api/useOpportunityMutations";

vi.mock("@/hooks/api/useGetCurrentUser");
vi.mock("@/hooks/api/useGetRoom");
vi.mock("@/hooks/api/useGetFolderContents");
vi.mock("@/hooks/api/useUploadDocuments");
// Partial mock: keep the real `OpportunityMutationError` class (Room.tsx
// does `instanceof` checks against it) and mock only the three hooks.
vi.mock("@/hooks/api/useOpportunityMutations", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/hooks/api/useOpportunityMutations")
    >();
  return {
    ...actual,
    useCreateOpportunity: vi.fn(),
    useRenameOpportunity: vi.fn(),
    useArchiveOpportunity: vi.fn(),
  };
});

const mockUseGetCurrentUser = vi.mocked(useGetCurrentUser);
const mockUseGetRoom = vi.mocked(useGetRoom);
const mockUseGetFolderContents = vi.mocked(useGetFolderContents);
const mockUseUploadDocuments = vi.mocked(useUploadDocuments);
const mockUseCreateOpportunity = vi.mocked(useCreateOpportunity);
const mockUseRenameOpportunity = vi.mocked(useRenameOpportunity);
const mockUseArchiveOpportunity = vi.mocked(useArchiveOpportunity);

/** A minimal stand-in for react-query's `UseMutationResult` — Room.tsx
 *  only reads `mutate`/`isPending`/`error`/`reset` off these, so the mock
 *  only needs to satisfy that surface (cast past the rest of the real
 *  type, which callers never touch). Generic over the target hook's
 *  return type since create/rename/archive each take different
 *  mutation variables. */
function makeMutationStub<
  T extends
    | ReturnType<typeof useCreateOpportunity>
    | ReturnType<typeof useRenameOpportunity>
    | ReturnType<typeof useArchiveOpportunity>,
>(
  overrides: {
    mutate?: ReturnType<typeof vi.fn>;
    isPending?: boolean;
    error?: Error | null;
    reset?: ReturnType<typeof vi.fn>;
  } = {},
): T {
  return {
    mutate: overrides.mutate ?? vi.fn(),
    isPending: overrides.isPending ?? false,
    error: overrides.error ?? null,
    reset: overrides.reset ?? vi.fn(),
  } as unknown as T;
}

const baseUser = {
  userId: "u-1",
  email: "ada@example.com",
  fullName: "Ada Lovelace",
  role: "owner" as const,
  orgId: "org-1",
  orgName: "Acme",
  opportunityScopes: [],
  emailVerified: true,
  mfaEnrolled: true,
  lifecycleState: "active" as const,
};

const opportunity: OpportunityDTO = {
  id: "opp-1",
  slug: "Vendor_A",
  name: "Vendor A",
  status: "active",
  createdAt: "2026-06-01T00:00:00.000Z",
};

const companyOverviewDoc: DocumentDTO = {
  id: "doc-1",
  displayName: "Certificate_of_Incorporation.pdf",
  folder: { kind: "canonical", folder: "01_Company_Overview" },
  currentVersion: {
    id: "v-1",
    versionNumber: 1,
    originalFilename: "cert.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    sha256: "abc123",
    uploadedBy: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    uploadedAt: "2026-07-01T00:00:00.000Z",
  },
  state: "active",
  createdAt: "2026-07-01T00:00:00.000Z",
};

const opportunityDoc: DocumentDTO = {
  ...companyOverviewDoc,
  id: "doc-2",
  displayName: "MSA_draft.docx",
  folder: { kind: "opportunity", opportunityId: "opp-1", slug: "Vendor_A" },
};

const room: RoomDTO = {
  folders: [...CANONICAL_FOLDERS],
  opportunities: [opportunity],
};

function mockFolderContents(
  resolve: (target: FolderTarget | undefined) => {
    listing: { documents: DocumentDTO[] } | undefined;
    status: "pending" | "success" | "error";
    isError: boolean;
  },
) {
  mockUseGetFolderContents.mockImplementation((_orgId, target) =>
    resolve(target),
  );
}

function renderRoom() {
  return render(
    <MemoryRouter>
      <Room />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  mockUseUploadDocuments.mockReturnValue({
    uploads: [],
    startUploads: vi.fn(),
    cancelUpload: vi.fn(),
    dismiss: vi.fn(),
  });
  mockUseCreateOpportunity.mockReturnValue(
    makeMutationStub<ReturnType<typeof useCreateOpportunity>>(),
  );
  mockUseRenameOpportunity.mockReturnValue(
    makeMutationStub<ReturnType<typeof useRenameOpportunity>>(),
  );
  mockUseArchiveOpportunity.mockReturnValue(
    makeMutationStub<ReturnType<typeof useArchiveOpportunity>>(),
  );
});

describe("Room", () => {
  it("shows the Loader while the current user is unresolved", () => {
    mockUseGetCurrentUser.mockReturnValue({
      isAuthenticated: false,
      user: undefined,
      status: "pending",
    });
    mockUseGetRoom.mockReturnValue({
      room: undefined,
      status: "pending",
      isError: false,
    });
    mockFolderContents(() => ({
      listing: undefined,
      status: "pending",
      isError: false,
    }));

    renderRoom();
    // The full-bleed route owns its own auth guard (it's not nested under
    // LoggedInPageLayout), so a pending session shows the Loader...
    expect(screen.getByRole("status")).toBeDefined();
    expect(screen.queryByText("CANONICAL ROOM")).toBeNull();
  });

  it("redirects to / when the visitor is unauthenticated", () => {
    mockUseGetCurrentUser.mockReturnValue({
      isAuthenticated: false,
      user: undefined,
      status: "success",
    });
    mockUseGetRoom.mockReturnValue({
      room: undefined,
      status: "pending",
      isError: false,
    });
    mockFolderContents(() => ({
      listing: undefined,
      status: "pending",
      isError: false,
    }));

    // ...and a resolved-but-unauthenticated session redirects away (the
    // room shell never renders).
    renderRoom();
    expect(screen.queryByText("CANONICAL ROOM")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders the unprovisioned-user placeholder when orgId is null", () => {
    mockUseGetCurrentUser.mockReturnValue({
      isAuthenticated: true,
      user: { ...baseUser, orgId: null, orgName: null },
      status: "success",
    });
    mockUseGetRoom.mockReturnValue({
      room: undefined,
      status: "pending",
      isError: false,
    });
    mockFolderContents(() => ({
      listing: undefined,
      status: "pending",
      isError: false,
    }));

    renderRoom();

    expect(screen.getByText("Welcome to AI Data Room")).toBeDefined();
    expect(screen.getByText(/onboarding flow/i)).toBeDefined();
  });

  it("shows the Loader while the room overview is loading", () => {
    mockUseGetCurrentUser.mockReturnValue({
      isAuthenticated: true,
      user: baseUser,
      status: "success",
    });
    mockUseGetRoom.mockReturnValue({
      room: undefined,
      status: "pending",
      isError: false,
    });
    mockFolderContents(() => ({
      listing: undefined,
      status: "pending",
      isError: false,
    }));

    renderRoom();

    expect(screen.getByRole("status")).toBeDefined();
  });

  it("shows a load-error message when the room fetch fails", () => {
    mockUseGetCurrentUser.mockReturnValue({
      isAuthenticated: true,
      user: baseUser,
      status: "success",
    });
    mockUseGetRoom.mockReturnValue({
      room: undefined,
      status: "success",
      isError: true,
    });
    mockFolderContents(() => ({
      listing: undefined,
      status: "pending",
      isError: false,
    }));

    renderRoom();

    expect(screen.getByText(/couldn't load the room/i)).toBeDefined();
  });

  describe("with a loaded room", () => {
    beforeEach(() => {
      mockUseGetCurrentUser.mockReturnValue({
        isAuthenticated: true,
        user: baseUser,
        status: "success",
      });
      mockUseGetRoom.mockReturnValue({
        room,
        status: "success",
        isError: false,
      });
    });

    it("renders all 7 canonical folders and the opportunity, defaulting to the first folder", () => {
      mockFolderContents((target) => {
        if (
          target?.kind === "canonical" &&
          target.folder === "01_Company_Overview"
        ) {
          return {
            listing: { documents: [companyOverviewDoc] },
            status: "success",
            isError: false,
          };
        }
        return {
          listing: { documents: [] },
          status: "success",
          isError: false,
        };
      });

      renderRoom();

      expect(
        screen.getByRole("heading", { name: "Company Overview" }),
      ).toBeDefined();
      expect(screen.getByText("Financials")).toBeDefined();
      expect(screen.getByText("Information Security")).toBeDefined();
      expect(screen.getByText("Vendor A")).toBeDefined();

      // Defaults to the first canonical folder.
      expect(
        screen.getByText("01_COMPANY_OVERVIEW · CANONICAL ROOM"),
      ).toBeDefined();
      expect(
        screen.getByText("Certificate_of_Incorporation.pdf"),
      ).toBeDefined();
      expect(screen.getByText("a1b2c3d4")).toBeDefined();
      expect(screen.getByText("01 Jul 2026")).toBeDefined();
    });

    it("switches the document list when a different folder is selected", () => {
      mockFolderContents((target) => {
        if (target?.kind === "canonical" && target.folder === "02_Financials") {
          return {
            listing: { documents: [] },
            status: "success",
            isError: false,
          };
        }
        return {
          listing: { documents: [companyOverviewDoc] },
          status: "success",
          isError: false,
        };
      });

      renderRoom();

      fireEvent.click(screen.getByText("Financials"));

      expect(screen.getByText("02_FINANCIALS · CANONICAL ROOM")).toBeDefined();
      expect(
        screen.getByText(/no documents in this folder yet/i),
      ).toBeDefined();
      expect(screen.queryByText("Certificate_of_Incorporation.pdf")).toBeNull();
    });

    it("lists an opportunity's documents when selected, with the OPPORTUNITY eyebrow", () => {
      mockFolderContents((target) => {
        if (target?.kind === "opportunity") {
          return {
            listing: { documents: [opportunityDoc] },
            status: "success",
            isError: false,
          };
        }
        return {
          listing: { documents: [] },
          status: "success",
          isError: false,
        };
      });

      renderRoom();

      fireEvent.click(screen.getByText("Vendor A"));

      expect(screen.getByText("VENDOR_A · OPPORTUNITY")).toBeDefined();
      expect(screen.getByText("MSA_draft.docx")).toBeDefined();
    });

    it("shows a muted message when there are no opportunities", () => {
      mockUseGetRoom.mockReturnValue({
        room: { ...room, opportunities: [] },
        status: "success",
        isError: false,
      });
      mockFolderContents(() => ({
        listing: { documents: [] },
        status: "success",
        isError: false,
      }));

      renderRoom();

      expect(screen.getByText("No opportunities yet.")).toBeDefined();
    });

    it("shows a loading indicator while the folder's documents are loading", () => {
      mockFolderContents(() => ({
        listing: undefined,
        status: "pending",
        isError: false,
      }));

      renderRoom();

      expect(screen.getByText("Loading…")).toBeDefined();
    });

    it("shows an error (not an empty state) when the folder listing fails", () => {
      // eden resolves a non-2xx without throwing → hook reports isError with
      // an undefined listing while react-query status is "success".
      mockFolderContents(() => ({
        listing: undefined,
        status: "success",
        isError: true,
      }));

      renderRoom();

      expect(screen.getByText(/Couldn't load this folder/i)).toBeDefined();
      // Must NOT masquerade as an empty folder in a data room.
      expect(screen.queryByText(/No documents in this folder yet/i)).toBeNull();
    });

    it("renders the org/role pill", () => {
      mockFolderContents(() => ({
        listing: { documents: [] },
        status: "success",
        isError: false,
      }));

      renderRoom();

      expect(screen.getByText("Owner")).toBeDefined();
    });

    it("shows the Upload button for an owner and opens the modal on click", () => {
      mockFolderContents(() => ({
        listing: { documents: [] },
        status: "success",
        isError: false,
      }));

      renderRoom();

      const uploadButton = screen.getByRole("button", { name: "Upload" });
      expect(uploadButton).toBeDefined();
      expect(screen.queryByRole("dialog")).toBeNull();

      fireEvent.click(uploadButton);

      expect(screen.getByRole("dialog")).toBeDefined();
      expect(
        screen.getByText(/drop documents here, or click to browse/i),
      ).toBeDefined();

      fireEvent.click(screen.getByRole("button", { name: "Done" }));

      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("shows the Upload button for an editor", () => {
      mockUseGetCurrentUser.mockReturnValue({
        isAuthenticated: true,
        user: { ...baseUser, role: "editor" },
        status: "success",
      });
      mockFolderContents(() => ({
        listing: { documents: [] },
        status: "success",
        isError: false,
      }));

      renderRoom();

      expect(screen.getByRole("button", { name: "Upload" })).toBeDefined();
    });

    it("hides the Upload button for a viewer", () => {
      mockUseGetCurrentUser.mockReturnValue({
        isAuthenticated: true,
        user: { ...baseUser, role: "viewer" },
        status: "success",
      });
      mockFolderContents(() => ({
        listing: { documents: [] },
        status: "success",
        isError: false,
      }));

      renderRoom();

      expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    });

    it('shows the "New" button for an owner and opens the create modal on click', () => {
      mockFolderContents(() => ({
        listing: { documents: [] },
        status: "success",
        isError: false,
      }));

      renderRoom();

      const newButton = screen.getByRole("button", { name: "New" });
      expect(screen.queryByRole("dialog")).toBeNull();

      fireEvent.click(newButton);

      expect(screen.getByRole("dialog")).toBeDefined();
      expect(screen.getByText("New opportunity")).toBeDefined();
    });

    it('hides the "New" button for a viewer', () => {
      mockUseGetCurrentUser.mockReturnValue({
        isAuthenticated: true,
        user: { ...baseUser, role: "viewer" },
        status: "success",
      });
      mockFolderContents(() => ({
        listing: { documents: [] },
        status: "success",
        isError: false,
      }));

      renderRoom();

      expect(screen.queryByRole("button", { name: "New" })).toBeNull();
    });

    it("shows Rename and Archive for an owner only once an opportunity is selected", () => {
      mockFolderContents(() => ({
        listing: { documents: [] },
        status: "success",
        isError: false,
      }));

      renderRoom();

      expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();

      fireEvent.click(screen.getByText("Vendor A"));

      expect(screen.getByRole("button", { name: "Rename" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Archive" })).toBeDefined();
    });

    it("hides Rename and Archive for a viewer even with an opportunity selected", () => {
      mockUseGetCurrentUser.mockReturnValue({
        isAuthenticated: true,
        user: { ...baseUser, role: "viewer" },
        status: "success",
      });
      mockFolderContents(() => ({
        listing: { documents: [] },
        status: "success",
        isError: false,
      }));

      renderRoom();

      fireEvent.click(screen.getByText("Vendor A"));

      expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    });

    it("creates an opportunity and selects it, closing the modal on success", () => {
      const createdDto: OpportunityDTO = {
        id: "opp-2",
        slug: "Vendor_C",
        name: "Vendor C",
        status: "active",
        createdAt: "2026-07-10T00:00:00.000Z",
      };
      const mutate = vi.fn(
        (
          _vars: { slug: string; name?: string },
          opts: { onSuccess: (dto: OpportunityDTO) => void },
        ) => opts.onSuccess(createdDto),
      );
      mockUseCreateOpportunity.mockReturnValue(
        makeMutationStub<ReturnType<typeof useCreateOpportunity>>({ mutate }),
      );
      mockFolderContents(() => ({
        listing: { documents: [] },
        status: "success",
        isError: false,
      }));

      renderRoom();

      fireEvent.click(screen.getByRole("button", { name: "New" }));
      fireEvent.change(screen.getByLabelText("Slug"), {
        target: { value: "Vendor_C" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create" }));

      expect(mutate).toHaveBeenCalledWith(
        { slug: "Vendor_C", name: undefined },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByText("VENDOR_C · OPPORTUNITY")).toBeDefined();
    });

    it("renames the selected opportunity and updates the selection on success", () => {
      const renamedDto: OpportunityDTO = {
        id: "opp-1",
        slug: "Vendor_A2",
        name: "Vendor A2",
        status: "active",
        createdAt: "2026-07-10T00:00:00.000Z",
      };
      const mutate = vi.fn(
        (
          _vars: { id: string; slug: string; name?: string },
          opts: { onSuccess: (dto: OpportunityDTO) => void },
        ) => opts.onSuccess(renamedDto),
      );
      mockUseRenameOpportunity.mockReturnValue(
        makeMutationStub<ReturnType<typeof useRenameOpportunity>>({ mutate }),
      );
      mockFolderContents(() => ({
        listing: { documents: [] },
        status: "success",
        isError: false,
      }));

      renderRoom();

      fireEvent.click(screen.getByText("Vendor A"));
      fireEvent.click(screen.getByRole("button", { name: "Rename" }));

      expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(
        "Vendor_A",
      );

      fireEvent.change(screen.getByLabelText("Slug"), {
        target: { value: "Vendor_A2" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(mutate).toHaveBeenCalledWith(
        { id: "opp-1", slug: "Vendor_A2", name: "Vendor A" },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByText("VENDOR_A2 · OPPORTUNITY")).toBeDefined();
    });

    it("archives the selected opportunity and clears the selection on success", () => {
      const archivedDto: OpportunityDTO = {
        id: "opp-1",
        slug: "Vendor_A",
        name: "Vendor A",
        status: "archived",
        createdAt: "2026-07-10T00:00:00.000Z",
      };
      const mutate = vi.fn(
        (
          _vars: { id: string },
          opts: { onSuccess: (dto: OpportunityDTO) => void },
        ) => opts.onSuccess(archivedDto),
      );
      mockUseArchiveOpportunity.mockReturnValue(
        makeMutationStub<ReturnType<typeof useArchiveOpportunity>>({
          mutate,
        }),
      );
      mockFolderContents(() => ({
        listing: { documents: [] },
        status: "success",
        isError: false,
      }));

      renderRoom();

      fireEvent.click(screen.getByText("Vendor A"));
      fireEvent.click(screen.getByRole("button", { name: "Archive" }));

      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));

      expect(mutate).toHaveBeenCalledWith(
        { id: "opp-1" },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      // Selection is cleared — falls back to the first canonical folder.
      expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    });

    it("closes the create modal via Cancel and resets the mutation state", () => {
      const reset = vi.fn();
      mockUseCreateOpportunity.mockReturnValue(
        makeMutationStub<ReturnType<typeof useCreateOpportunity>>({ reset }),
      );
      mockFolderContents(() => ({
        listing: { documents: [] },
        status: "success",
        isError: false,
      }));

      renderRoom();

      fireEvent.click(screen.getByRole("button", { name: "New" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(reset).toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("closes the archive dialog via Cancel and resets the mutation state", () => {
      const reset = vi.fn();
      mockUseArchiveOpportunity.mockReturnValue(
        makeMutationStub<ReturnType<typeof useArchiveOpportunity>>({ reset }),
      );
      mockFolderContents(() => ({
        listing: { documents: [] },
        status: "success",
        isError: false,
      }));

      renderRoom();

      fireEvent.click(screen.getByText("Vendor A"));
      fireEvent.click(screen.getByRole("button", { name: "Archive" }));

      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

      expect(reset).toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("surfaces a slug_taken create-mutation error in the form modal", () => {
      mockUseCreateOpportunity.mockReturnValue(
        makeMutationStub<ReturnType<typeof useCreateOpportunity>>({
          error: new OpportunityMutationError("slug_taken"),
        }),
      );
      mockFolderContents(() => ({
        listing: { documents: [] },
        status: "success",
        isError: false,
      }));

      renderRoom();

      fireEvent.click(screen.getByRole("button", { name: "New" }));

      expect(screen.getByText(/already exists/i)).toBeDefined();
    });
  });
});
