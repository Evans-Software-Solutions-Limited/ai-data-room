import { useState } from "react";
import { Link, Navigate } from "react-router";
import type {
  CanonicalFolder,
  DocumentDTO,
} from "@ai-data-room/api-utils/schemas/rooms";

import { Loader } from "@/components/Loader";
import {
  BrandDiamond,
  ChevronRightIcon,
  StatusDot,
} from "@/components/room/icons";
import { useGetCurrentUser } from "@/hooks/api/useGetCurrentUser";
import {
  useGetFolderContents,
  type FolderTarget,
} from "@/hooks/api/useGetFolderContents";
import { useGetRoom } from "@/hooks/api/useGetRoom";
import { canonicalFolderDescription } from "@/lib/folderDescriptions";
import { canonicalFolderLabel } from "@/lib/canonicalFolderLabel";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/formatDate";
import { formatUploaderId } from "@/lib/formatUploaderId";

// The `/room` folder-navigation + document list screen — room-and-folders
// (slice 2), T-013. STRICT slice-2 scope: shell + folder nav + document
// list only. No checklist panel (slice 4), no AI sense-check (slice 5), no
// upload (T-014), no soft-delete/restore/versions (T-016), no "view-as"
// identity switcher (mocked-auth preview only, prod uses the real
// session), and no Workspace nav links wired up (Ask the room / Audit log
// / Members belong to later slices). The reserved `--room-ai-*`... in
// fact the `--ai-*` indigo group is not even declared in `index.css` yet
// (see its header comment) — this page uses ink + the status palette only.

type Selection =
  | { kind: "canonical"; folder: CanonicalFolder }
  | { kind: "opportunity"; id: string; name: string; slug: string };

const Room = () => {
  // `/room` is a full-bleed app shell that OWNS its chrome (sidebar + top
  // bar), so it's a standalone route — NOT nested under `LoggedInPageLayout`
  // (whose global `NavBar` would stack a second top bar above the room
  // shell). It therefore reproduces that layout's auth guard here.
  const { isAuthenticated, user, status } = useGetCurrentUser();

  if (status === "pending") return <Loader />;
  if (!isAuthenticated || !user) return <Navigate to="/" replace />;

  // Mirrors `AppWorkspace.tsx`'s "not attached to an org yet" placeholder —
  // same gap (org provisioning ships in slice 9), same copy.
  if (!user.orgId) {
    return (
      <section className="flex flex-col gap-3 p-4">
        <h1 className="text-2xl font-semibold">Welcome to AI Data Room</h1>
        <p className="text-muted-foreground">
          You're signed in, but your account isn't attached to an organisation
          yet. Org provisioning lands in the onboarding flow (slice 9) — until
          then there's no workspace to show.
        </p>
        <p className="text-sm">
          <Link to="/" className="underline">
            Back to the landing page
          </Link>
        </p>
      </section>
    );
  }

  return (
    <RoomShell orgId={user.orgId} orgName={user.orgName} role={user.role} />
  );
};

function RoomShell({
  orgId,
  orgName,
  role,
}: {
  orgId: string;
  orgName: string | null;
  role: string | null;
}) {
  const { room, status: roomStatus } = useGetRoom(orgId);
  const [selection, setSelection] = useState<Selection | null>(null);

  // Default-select the first canonical folder until the room has loaded and
  // the user hasn't picked anything yet — derived rather than an effect, so
  // there's no extra render/flash once `room` arrives.
  const effectiveSelection: Selection | null =
    selection ??
    (room && room.folders.length > 0
      ? { kind: "canonical", folder: room.folders[0] }
      : null);

  const target: FolderTarget | undefined = effectiveSelection
    ? effectiveSelection.kind === "canonical"
      ? { kind: "canonical", folder: effectiveSelection.folder }
      : { kind: "opportunity", id: effectiveSelection.id }
    : undefined;

  const {
    listing,
    status: listingStatus,
    isError: listingIsError,
  } = useGetFolderContents(orgId, target);

  if (roomStatus === "pending") {
    return <Loader />;
  }

  if (!room) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">
          Couldn't load the room. Try refreshing the page.
        </p>
      </div>
    );
  }

  const folderLabel =
    effectiveSelection?.kind === "canonical"
      ? canonicalFolderLabel(effectiveSelection.folder)
      : null;

  const title = !effectiveSelection
    ? "Select a folder"
    : effectiveSelection.kind === "canonical"
      ? (folderLabel?.name ?? "")
      : effectiveSelection.name;

  const eyebrow = !effectiveSelection
    ? null
    : effectiveSelection.kind === "canonical"
      ? `${effectiveSelection.folder.toUpperCase()} · CANONICAL ROOM`
      : `${effectiveSelection.slug.toUpperCase()} · OPPORTUNITY`;

  const description = !effectiveSelection
    ? ""
    : effectiveSelection.kind === "canonical"
      ? canonicalFolderDescription(effectiveSelection.folder)
      : "Documents shared for this opportunity.";

  const roleLabel = role
    ? role.charAt(0).toUpperCase() + role.slice(1)
    : "Member";

  return (
    <div className="flex min-h-dvh bg-room-paper font-room-sans text-[15px] text-room-ink">
      <aside className="flex w-[260px] shrink-0 flex-col gap-6 border-r border-room-rule bg-room-paper-2 px-4 py-5">
        <div className="flex items-center gap-2 px-1">
          <BrandDiamond className="h-3.5 w-3.5 text-room-ink" />
          <span className="text-sm font-semibold tracking-tight">
            <span className="text-room-ink">datum</span>
            <span className="text-room-ink-3">/room</span>
          </span>
        </div>

        <nav
          aria-label="Canonical room folders"
          className="flex flex-col gap-1"
        >
          <SectionLabel>Canonical room</SectionLabel>
          {room.folders.map((folder) => {
            const label = canonicalFolderLabel(folder);
            const selected =
              effectiveSelection?.kind === "canonical" &&
              effectiveSelection.folder === folder;
            return (
              <FolderRow
                key={folder}
                number={label.number}
                name={label.name}
                selected={selected}
                onSelect={() => setSelection({ kind: "canonical", folder })}
              />
            );
          })}
        </nav>

        <nav aria-label="Opportunities" className="flex flex-col gap-1">
          <SectionLabel>Opportunities</SectionLabel>
          {room.opportunities.length === 0 ? (
            <p className="px-2 py-1 text-xs text-room-ink-3">
              No opportunities yet.
            </p>
          ) : (
            room.opportunities.map((opportunity) => {
              const selected =
                effectiveSelection?.kind === "opportunity" &&
                effectiveSelection.id === opportunity.id;
              return (
                <FolderRow
                  key={opportunity.id}
                  name={opportunity.name}
                  selected={selected}
                  onSelect={() =>
                    setSelection({
                      kind: "opportunity",
                      id: opportunity.id,
                      name: opportunity.name,
                      slug: opportunity.slug,
                    })
                  }
                />
              );
            })
          )}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-room-rule px-6">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1.5 text-sm text-room-ink-2"
          >
            <span>{orgName ?? "Organisation"}</span>
            {effectiveSelection && (
              <>
                <ChevronRightIcon className="h-3 w-3 text-room-ink-3" />
                <span className="text-room-ink">{title}</span>
              </>
            )}
          </nav>
          <span className="rounded-room-pill bg-room-ink px-3 py-1 text-xs font-medium text-room-ink-on-dark">
            {roleLabel}
          </span>
        </header>

        <main className="mx-auto w-full max-w-[1180px] flex-1 px-8 py-8">
          {eyebrow && (
            <p className="font-room-mono text-xs uppercase tracking-wide text-room-ink-3">
              {eyebrow}
            </p>
          )}
          <h1 className="mt-2 font-room-serif text-[34px] leading-tight text-room-ink">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-[60ch] text-sm text-room-ink-2">
              {description}
            </p>
          )}

          <div className="mt-8">
            {listingStatus === "pending" ? (
              <div className="flex justify-center py-10">
                <span className="text-sm text-room-ink-3">Loading…</span>
              </div>
            ) : listingIsError ? (
              // eden resolves a non-2xx (401 expired session, 403 from the
              // slice-3 access-control gate, 500) WITHOUT throwing, so the
              // hook surfaces it as `isError` with `listing` undefined. Show
              // a distinct error — never a "no documents" empty state, which
              // in a data room would wrongly read as "the folder is empty".
              <div className="flex min-h-40 flex-col items-center justify-center gap-1 rounded-room-lg border border-room-rule py-12 text-center">
                <p className="text-sm text-room-ink-2">
                  Couldn't load this folder. Try refreshing.
                </p>
              </div>
            ) : listing && listing.documents.length > 0 ? (
              <DocumentsTable documents={listing.documents} />
            ) : (
              <div className="flex min-h-40 flex-col items-center justify-center gap-1 rounded-room-lg border border-dashed border-room-rule py-12 text-center">
                <p className="text-sm text-room-ink-2">
                  No documents in this folder yet.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 text-[11px] font-semibold tracking-wide text-room-ink-3 uppercase">
      {children}
    </span>
  );
}

function FolderRow({
  number,
  name,
  selected,
  onSelect,
}: {
  number?: string;
  name: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex items-center justify-between gap-2 rounded-room px-2 py-1.5 text-left text-sm transition-colors",
        selected
          ? "border border-room-rule bg-room-card text-room-ink shadow-room-1"
          : "border border-transparent text-room-ink-2 hover:bg-room-paper-3/60",
      )}
    >
      <span className="flex items-center gap-2 truncate">
        {number && (
          <span className="font-room-mono text-xs text-room-ink-3">
            {number}
          </span>
        )}
        <span className="truncate">{name}</span>
      </span>
      <StatusDot
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          selected ? "text-room-ink-3" : "text-room-rule-strong",
        )}
      />
    </button>
  );
}

function DocumentsTable({ documents }: { documents: DocumentDTO[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-room-rule text-left text-xs tracking-wide text-room-ink-3 uppercase">
          <th className="py-2 pr-4 font-normal">Filename</th>
          <th className="py-2 pr-4 font-normal">Uploader</th>
          <th className="py-2 font-normal">Added</th>
        </tr>
      </thead>
      <tbody>
        {documents.map((document) => (
          <tr
            key={document.id}
            className="border-b border-room-rule-2 last:border-0"
          >
            <td
              className="max-w-0 truncate py-3 pr-4 font-room-mono text-room-ink"
              title={document.displayName}
            >
              {document.displayName}
            </td>
            <td
              className="py-3 pr-4 text-room-ink-2"
              title={document.currentVersion.uploadedBy}
            >
              {formatUploaderId(document.currentVersion.uploadedBy)}
            </td>
            <td className="py-3 font-room-mono text-room-ink-2">
              {formatDate(document.createdAt)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default Room;
