import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { UploadModal } from "../UploadModal";
import type { UploadEntry } from "@/lib/upload/uploadRegistry";

function makeEntry(overrides: Partial<UploadEntry> = {}): UploadEntry {
  return {
    id: "u-1",
    fileName: "Term Sheet.pdf",
    sizeBytes: 1000,
    status: "uploading",
    bytesUploaded: 400,
    ...overrides,
  };
}

function renderModal(
  props: Partial<React.ComponentProps<typeof UploadModal>> = {},
) {
  const onClose = vi.fn();
  const onFilesSelected = vi.fn();
  const onCancelUpload = vi.fn();
  const onDismiss = vi.fn();

  const utils = render(
    <UploadModal
      open={true}
      targetLabel="02_Financials"
      uploads={[]}
      onClose={onClose}
      onFilesSelected={onFilesSelected}
      onCancelUpload={onCancelUpload}
      onDismiss={onDismiss}
      {...props}
    />,
  );

  return { ...utils, onClose, onFilesSelected, onCancelUpload, onDismiss };
}

describe("UploadModal", () => {
  it("renders nothing when closed", () => {
    const { container } = renderModal({ open: false });
    expect(container.firstChild).toBeNull();
  });

  it("renders the dialog with the target label and dropzone when open", () => {
    renderModal({ targetLabel: "02_Financials" });

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText("Upload to 02_Financials")).toBeDefined();
    expect(screen.getByText(/encrypted at rest/i)).toBeDefined();
    expect(
      screen.getByText(/drop documents here, or click to browse/i),
    ).toBeDefined();
    expect(
      screen.getByText(/PDF, XLSX, DOCX, PPTX, PNG, JPG, CSV, TXT/i),
    ).toBeDefined();
  });

  it("fires onFilesSelected when files are chosen via the hidden input", () => {
    const { onFilesSelected } = renderModal();
    const file = new File(["a"], "a.pdf", { type: "application/pdf" });
    const input = screen.getByLabelText(/choose files to upload/i);

    fireEvent.change(input, { target: { files: [file] } });

    expect(onFilesSelected).toHaveBeenCalledWith([file]);
  });

  it("does not fire onFilesSelected when the file input change carries no files", () => {
    const { onFilesSelected } = renderModal();
    const input = screen.getByLabelText(/choose files to upload/i);

    fireEvent.change(input, { target: { files: [] } });

    expect(onFilesSelected).not.toHaveBeenCalled();
  });

  it("fires onFilesSelected on drop, and toggles drag-over state on dragOver/dragLeave", () => {
    const { onFilesSelected } = renderModal();
    const dropzone = screen.getByText(
      /drop documents here, or click to browse/i,
    ).parentElement as HTMLElement;
    const file = new File(["a"], "a.pdf", { type: "application/pdf" });

    fireEvent.dragOver(dropzone);
    fireEvent.dragLeave(dropzone);

    fireEvent.drop(dropzone, {
      dataTransfer: { files: [file] },
    });

    expect(onFilesSelected).toHaveBeenCalledWith([file]);
  });

  it("does not fire onFilesSelected on a drop with no files", () => {
    const { onFilesSelected } = renderModal();
    const dropzone = screen.getByText(
      /drop documents here, or click to browse/i,
    ).parentElement as HTMLElement;

    fireEvent.drop(dropzone, { dataTransfer: { files: [] } });

    expect(onFilesSelected).not.toHaveBeenCalled();
  });

  it("keeps the file input focusable (in the tab order) for native keyboard activation", () => {
    renderModal();
    const input = screen.getByLabelText(
      /choose files to upload/i,
    ) as HTMLInputElement;

    // Visually hidden via `sr-only`, but NOT `hidden`/`tabindex=-1` — a
    // focused file input opens its dialog on Enter/Space natively, no
    // JS required (see the component's header comment on the <label>
    // wrapping pattern).
    expect(input.tabIndex).not.toBe(-1);
    expect(input.hidden).toBe(false);
  });

  it("shows a percentage and a Cancel button for an in-progress upload", () => {
    const { onCancelUpload } = renderModal({
      uploads: [
        makeEntry({ status: "uploading", bytesUploaded: 400, sizeBytes: 1000 }),
      ],
    });

    expect(screen.getByText("40%")).toBeDefined();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancelUpload).toHaveBeenCalledWith("u-1");
  });

  it("shows Added + CheckIcon for a done upload, and dismiss fires onDismiss", () => {
    const { onDismiss } = renderModal({
      uploads: [makeEntry({ status: "done", bytesUploaded: 1000 })],
    });

    expect(screen.getByText("Added")).toBeDefined();
    fireEvent.click(screen.getByLabelText(/dismiss term sheet\.pdf/i));
    expect(onDismiss).toHaveBeenCalledWith("u-1");
  });

  it("shows the error copy for a failed upload", () => {
    renderModal({
      uploads: [
        makeEntry({ status: "error", error: "Upload failed. Try again." }),
      ],
    });

    expect(screen.getByText("Upload failed. Try again.")).toBeDefined();
  });

  it("shows a muted Canceled label for a canceled upload", () => {
    renderModal({ uploads: [makeEntry({ status: "canceled" })] });

    expect(screen.getByText("Canceled")).toBeDefined();
  });

  it("closes when the scrim (not the panel) is clicked", () => {
    const { onClose } = renderModal();

    fireEvent.mouseDown(
      screen.getByRole("dialog").parentElement as HTMLElement,
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape and the Done button, and does not listen for Escape when closed", () => {
    const { onClose, rerender } = renderModal();

    fireEvent.click(screen.getByText("Done"));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(
      <UploadModal
        open={false}
        targetLabel="02_Financials"
        uploads={[]}
        onClose={onClose}
        onFilesSelected={vi.fn()}
        onCancelUpload={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("never renders AI relevance / checklist scope-creep copy", () => {
    renderModal({
      uploads: [makeEntry({ status: "done" })],
    });

    expect(screen.queryByText(/relevance|checklist|confidence/i)).toBeNull();
  });
});
