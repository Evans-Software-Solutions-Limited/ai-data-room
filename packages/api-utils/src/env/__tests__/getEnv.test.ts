import { vi } from "vitest";
import { getEnv, getEnvRaw, getEnvOrDefault } from "../getEnv";

describe("getEnvRaw", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return the value of an existing environment variable", () => {
    process.env.TEST_VAR = "test-value";

    expect(getEnvRaw("TEST_VAR")).toBe("test-value");
  });

  it("should return undefined for a non-existent environment variable", () => {
    delete process.env.NON_EXISTENT_VAR;

    expect(getEnvRaw("NON_EXISTENT_VAR")).toBeUndefined();
  });

  it("should return empty string for a variable set to empty string", () => {
    process.env.EMPTY_VAR = "";

    expect(getEnvRaw("EMPTY_VAR")).toBe("");
  });
});

describe("getEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return the value of an existing environment variable", () => {
    process.env.MY_VAR = "my-value";

    expect(getEnv("MY_VAR")).toBe("my-value");
  });

  it("should throw an error for a missing environment variable", () => {
    delete process.env.MISSING_VAR;

    expect(() => getEnv("MISSING_VAR")).toThrow(
      "Missing environment variable for MISSING_VAR",
    );
  });

  it("should return empty string if variable is set to empty string", () => {
    process.env.EMPTY_VAR = "";

    expect(getEnv("EMPTY_VAR")).toBe("");
  });
});

describe("getEnvOrDefault", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return the value of an existing environment variable", () => {
    process.env.EXISTING_VAR = "existing-value";

    expect(getEnvOrDefault("EXISTING_VAR", "default")).toBe("existing-value");
  });

  it("should return the default value for a missing environment variable", () => {
    delete process.env.MISSING_VAR;

    expect(getEnvOrDefault("MISSING_VAR", "fallback")).toBe("fallback");
  });

  it("should return the actual value (even empty string) over the default", () => {
    process.env.EMPTY_VAR = "";

    expect(getEnvOrDefault("EMPTY_VAR", "default")).toBe("");
  });
});
