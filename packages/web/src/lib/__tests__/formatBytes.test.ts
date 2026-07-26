import { formatBytes } from "../formatBytes";

describe("formatBytes", () => {
  it("renders sub-1024 sizes as whole bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(800)).toBe("800 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("renders exact KB multiples without a decimal", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(512 * 1024)).toBe("512 KB");
  });

  it("renders inexact sizes with one decimal place", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("renders MB and GB boundaries", () => {
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(1.2 * 1024 * 1024)).toBe("1.2 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1 GB");
  });

  it("promotes to the next unit when rounding hits 1024 near a boundary", () => {
    // 1 byte under 1 MB: 1023.999… KB must round to "1 MB", not "1024 KB".
    expect(formatBytes(1024 * 1024 - 1)).toBe("1 MB");
    // 1 byte under 1 GB: must read "1 GB", not "1024 MB".
    expect(formatBytes(1024 * 1024 * 1024 - 1)).toBe("1 GB");
  });

  it("caps at GB (does not roll over to TB)", () => {
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe("1024 GB");
  });
});
