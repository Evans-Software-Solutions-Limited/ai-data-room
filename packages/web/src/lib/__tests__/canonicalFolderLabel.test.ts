import { canonicalFolderLabel } from "../canonicalFolderLabel";

describe("canonicalFolderLabel", () => {
  it("splits the numeric prefix from a single-word folder name", () => {
    expect(canonicalFolderLabel("02_Financials")).toEqual({
      number: "02",
      name: "Financials",
    });
  });

  it("replaces underscores with spaces for multi-word folder names", () => {
    expect(canonicalFolderLabel("07_Information_Security")).toEqual({
      number: "07",
      name: "Information Security",
    });
  });

  it("handles every canonical folder key without throwing", () => {
    const keys = [
      "01_Company_Overview",
      "02_Financials",
      "03_Commercial",
      "04_Product",
      "05_Legal",
      "06_Operations",
      "07_Information_Security",
    ] as const;

    for (const key of keys) {
      const label = canonicalFolderLabel(key);
      expect(label.number).toHaveLength(2);
      expect(label.name.length).toBeGreaterThan(0);
    }
  });
});
