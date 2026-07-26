import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { ArchiveOpportunityDialog } from "../ArchiveOpportunityDialog";

function renderDialog(
  props: Partial<React.ComponentProps<typeof ArchiveOpportunityDialog>> = {},
) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();

  const utils = render(
    <ArchiveOpportunityDialog
      open={true}
      opportunityName="Vendor A"
      pending={false}
      onClose={onClose}
      onConfirm={onConfirm}
      {...props}
    />,
  );

  return { ...utils, onClose, onConfirm };
}

describe("ArchiveOpportunityDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = renderDialog({ open: false });
    expect(container.firstChild).toBeNull();
  });

  it("shows the opportunity name in the title and the retention copy", () => {
    renderDialog({ opportunityName: "Vendor A" });

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText("Archive Vendor A?")).toBeDefined();
    expect(screen.getByText(/90 days/i)).toBeDefined();
  });

  it("fires onConfirm when Archive is clicked", () => {
    const { onConfirm } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("fires onClose when Cancel is clicked", () => {
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons while pending", () => {
    renderDialog({ pending: true });

    expect(
      (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Archive" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("renders already_archived error copy", () => {
    renderDialog({ errorReason: "already_archived" });

    expect(screen.getByText(/already archived/i)).toBeDefined();
  });

  it("renders not_found error copy", () => {
    renderDialog({ errorReason: "not_found" });

    expect(screen.getByText(/no longer exists/i)).toBeDefined();
  });

  it("renders generic error copy for reasons that don't apply to archive", () => {
    renderDialog({ errorReason: "unknown" });

    expect(screen.getByText(/something went wrong/i)).toBeDefined();
  });

  it("closes on Escape and on scrim click", () => {
    const { onClose } = renderDialog();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByRole("dialog").parentElement as Element);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
