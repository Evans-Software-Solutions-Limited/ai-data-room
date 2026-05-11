import { formatUserDisplayName } from "../userDisplayName";

describe("formatUserDisplayName", () => {
  it("prefers the full name when present", () => {
    expect(
      formatUserDisplayName({
        fullName: "Ada Lovelace",
        email: "ada@example.com",
      }),
    ).toBe("Ada Lovelace");
  });

  it("trims whitespace before treating fullName as missing", () => {
    expect(
      formatUserDisplayName({ fullName: "   ", email: "ada@example.com" }),
    ).toBe("ada@example.com");
  });

  it("falls back to email when fullName is null", () => {
    expect(
      formatUserDisplayName({ fullName: null, email: "ada@example.com" }),
    ).toBe("ada@example.com");
  });

  it("falls back to a literal when neither name nor email is present", () => {
    expect(formatUserDisplayName({ fullName: null, email: null })).toBe(
      "Unknown user",
    );
  });
});
