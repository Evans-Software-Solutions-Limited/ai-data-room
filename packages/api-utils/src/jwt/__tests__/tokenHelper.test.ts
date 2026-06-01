import { vi } from "vitest";
import { TokenHelper } from "../tokenHelper";
import { unpackJWT } from "../unpackJWT";

vi.mock("../unpackJWT", () => ({
  unpackJWT: vi.fn(),
}));

describe("TokenHelper", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("removeBearerPrefix", () => {
    it("should remove the Bearer prefix from a token string", () => {
      const result = TokenHelper.removeBearerPrefix("Bearer abc123token");

      expect(result).toBe("abc123token");
    });

    it("should return the original string if no Bearer prefix is present", () => {
      const result = TokenHelper.removeBearerPrefix("abc123token");

      expect(result).toBe("abc123token");
    });

    it("should handle an empty string", () => {
      const result = TokenHelper.removeBearerPrefix("");

      expect(result).toBe("");
    });

    it("should be case-sensitive for the Bearer prefix", () => {
      const result = TokenHelper.removeBearerPrefix("bearer abc123token");

      expect(result).toBe("bearer abc123token");
    });

    it("should handle Bearer prefix with no token after it", () => {
      const result = TokenHelper.removeBearerPrefix("Bearer ");

      expect(result).toBe("");
    });
  });

  describe("extractDataFromToken", () => {
    it("should call unpackJWT and return the decoded data", () => {
      const mockPayload = { sub: "user123", role: "editor" };
      vi.mocked(unpackJWT).mockReturnValue(mockPayload);

      const result = TokenHelper.extractDataFromToken("some-token");

      expect(unpackJWT).toHaveBeenCalledWith("some-token");
      expect(result).toEqual(mockPayload);
    });

    it("should propagate errors from unpackJWT", () => {
      vi.mocked(unpackJWT).mockImplementation(() => {
        throw new Error("Decode failed");
      });

      expect(() => TokenHelper.extractDataFromToken("bad-token")).toThrow(
        "Decode failed",
      );
    });
  });

  describe("unsafeExtractDataFromToken", () => {
    it("should call unpackJWT and return the raw decoded data", () => {
      const mockData = { sub: "user456", custom: "value" };
      vi.mocked(unpackJWT).mockReturnValue(mockData);

      const result = TokenHelper.unsafeExtractDataFromToken("some-token");

      expect(unpackJWT).toHaveBeenCalledWith("some-token");
      expect(result).toEqual(mockData);
    });

    it("should propagate errors from unpackJWT", () => {
      vi.mocked(unpackJWT).mockImplementation(() => {
        throw new Error("Invalid");
      });

      expect(() => TokenHelper.unsafeExtractDataFromToken("bad-token")).toThrow(
        "Invalid",
      );
    });
  });
});
