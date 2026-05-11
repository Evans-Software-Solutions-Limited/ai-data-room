import { vi } from "vitest";

vi.mock("@elysiajs/eden", () => ({
  treaty: vi.fn(() => ({ me: { get: vi.fn() } })),
}));

vi.stubEnv("VITE_CORE_API_URL", "http://localhost:3000");

beforeEach(() => {
  vi.resetModules();
});

describe("eden", () => {
  it("exports an api object keyed on `core`", async () => {
    const { api } = await import("../eden");

    expect(api).toBeDefined();
    expect(api.core).toBeDefined();
  });

  it("constructs the core client with credentials: include for cookie auth", async () => {
    const { treaty } = await import("@elysiajs/eden");
    const treatyMock = vi.mocked(treaty);

    await import("../eden");

    expect(treatyMock).toHaveBeenCalled();
    const lastCall = treatyMock.mock.calls.at(-1) ?? [];
    expect(lastCall[1]).toMatchObject({
      fetch: { credentials: "include" },
    });
  });
});
