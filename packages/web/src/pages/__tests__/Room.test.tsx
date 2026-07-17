import { render, screen, fireEvent } from "@testing-library/react";
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

vi.mock("@/hooks/api/useGetCurrentUser");
vi.mock("@/hooks/api/useGetRoom");
vi.mock("@/hooks/api/useGetFolderContents");

const mockUseGetCurrentUser = vi.mocked(useGetCurrentUser);
const mockUseGetRoom = vi.mocked(useGetRoom);
const mockUseGetFolderContents = vi.mocked(useGetFolderContents);

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
  });
});
