import { formatDate } from "../formatDate";

describe("formatDate", () => {
  it("formats an ISO date string as day/short-month/year, en-GB", () => {
    expect(formatDate("2026-07-17T09:30:00.000Z")).toBe("17 Jul 2026");
  });

  it("formats a different month/day correctly", () => {
    expect(formatDate("2025-01-03T00:00:00.000Z")).toBe("03 Jan 2025");
  });
});
