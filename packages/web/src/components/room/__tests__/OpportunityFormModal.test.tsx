import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { OpportunityFormModal } from "../OpportunityFormModal";
import type { OpportunityMutationReason } from "@/hooks/api/useOpportunityMutations";

function renderModal(
  props: Partial<React.ComponentProps<typeof OpportunityFormModal>> = {},
) {
  const onClose = vi.fn();
  const onSubmit = vi.fn();

  const utils = render(
    <OpportunityFormModal
      open={true}
      mode="create"
      pending={false}
      onClose={onClose}
      onSubmit={onSubmit}
      {...props}
    />,
  );

  return { ...utils, onClose, onSubmit };
}

describe("OpportunityFormModal", () => {
  it("renders nothing when closed", () => {
    const { container } = renderModal({ open: false });
    expect(container.firstChild).toBeNull();
  });

  it("shows the create title with empty fields", () => {
    renderModal({ mode: "create" });

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText("New opportunity")).toBeDefined();
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("");
    expect(
      (screen.getByLabelText("Display name") as HTMLInputElement).value,
    ).toBe("");
    expect(screen.getByRole("button", { name: "Create" })).toBeDefined();
  });

  it("shows the rename title prefilled from initialSlug/initialName", () => {
    renderModal({
      mode: "rename",
      initialSlug: "Vendor_A",
      initialName: "Vendor A",
    });

    expect(screen.getByText("Rename opportunity")).toBeDefined();
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(
      "Vendor_A",
    );
    expect(
      (screen.getByLabelText("Display name") as HTMLInputElement).value,
    ).toBe("Vendor A");
    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
  });

  it("disables submit and shows the hint in error tone for an invalid slug", () => {
    renderModal();

    const slugInput = screen.getByLabelText("Slug");
    fireEvent.change(slugInput, { target: { value: "bad slug!" } });

    const submitButton = screen.getByRole("button", {
      name: "Create",
    }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    expect(
      screen.getByText(/letters, digits, underscore or hyphen/i).className,
    ).toContain("text-room-err");
  });

  it("disables submit when the slug is empty", () => {
    renderModal();

    expect(
      (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("fires onSubmit with a trimmed slug and undefined name when the name is blank", () => {
    const { onSubmit } = renderModal();

    fireEvent.change(screen.getByLabelText("Slug"), {
      target: { value: "Vendor_A" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onSubmit).toHaveBeenCalledWith({
      slug: "Vendor_A",
      name: undefined,
    });
  });

  it("fires onSubmit with the trimmed name when provided", () => {
    const { onSubmit } = renderModal();

    fireEvent.change(screen.getByLabelText("Slug"), {
      target: { value: "Vendor_A" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "  Vendor A  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onSubmit).toHaveBeenCalledWith({
      slug: "Vendor_A",
      name: "Vendor A",
    });
  });

  it("disables submit while pending", () => {
    renderModal({ pending: true, initialSlug: "Vendor_A" });

    expect(
      (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it.each([
    ["slug_taken", /already exists/i],
    ["not_found", /no longer exists/i],
  ] satisfies [OpportunityMutationReason, RegExp][])(
    "renders server error copy for %s",
    (reason, expected) => {
      renderModal({ mode: "rename", errorReason: reason });
      expect(screen.getByText(expected)).toBeDefined();
    },
  );

  it("renders the slug hint as the server error copy for invalid_slug", () => {
    renderModal({ mode: "create", errorReason: "invalid_slug" });

    // The persistent field hint and the server-error copy share the same
    // text for this reason — both instances should be present.
    expect(
      screen.getAllByText(/letters, digits, underscore or hyphen/i).length,
    ).toBe(2);
  });

  it("renders a generic message for a not_found error in create mode", () => {
    renderModal({ mode: "create", errorReason: "not_found" });

    expect(screen.getByText(/something went wrong/i)).toBeDefined();
  });

  it("renders a generic message for already_archived/unknown reasons", () => {
    renderModal({ mode: "create", errorReason: "unknown" });

    expect(screen.getByText(/something went wrong/i)).toBeDefined();
  });

  it("shows no access-control/AI/scope/invite copy (slice-2 scope guard)", () => {
    renderModal({
      mode: "rename",
      initialSlug: "Vendor_A",
      initialName: "Vendor A",
      errorReason: "slug_taken",
    });

    expect(screen.queryByText(/scope|viewer|nda|invite/i)).toBeNull();
  });

  it("closes on scrim click and on Escape", () => {
    const { onClose } = renderModal();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByRole("dialog").parentElement as Element);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
