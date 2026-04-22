import { vi, type Mock } from "vitest";
import { jwtDecode } from "jwt-decode";
import { type JWT, unpackJWT } from "../unpackJWT";

vi.mock("jwt-decode", () => ({
  jwtDecode: vi.fn(),
}));

describe("unpackJWT", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should correctly decode a standard JWT token", () => {
    const mockToken: JWT = {
      sub: "123456",
      exp: 9999999999,
      iss: "https://example.com/",
      iat: 999999999,
      email: "user@example.com",
    };

    (jwtDecode as Mock).mockReturnValue(mockToken);

    const result = unpackJWT("standardTokenString");

    expect(result).toEqual(mockToken);
    expect(jwtDecode).toHaveBeenCalledWith("standardTokenString");
    expect(jwtDecode).toHaveBeenCalledTimes(1);
  });

  it("should return an empty object token if decoded result is empty", () => {
    const emptyToken: JWT = {};
    (jwtDecode as Mock).mockReturnValue(emptyToken);

    const result = unpackJWT("emptyTokenString");

    expect(result).toEqual({});
  });

  it("should throw an error if jwtDecode throws an error", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    (jwtDecode as Mock).mockImplementation(() => {
      throw new Error("Invalid token");
    });

    expect(() => unpackJWT("invalidTokenString")).toThrow("Invalid token");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error decoding token",
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it("should re-throw the original error from jwtDecode", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const originalError = new TypeError("Malformed JWT");
    (jwtDecode as Mock).mockImplementation(() => {
      throw originalError;
    });

    try {
      unpackJWT("malformedToken");
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBe(originalError);
    }

    vi.restoreAllMocks();
  });
});
