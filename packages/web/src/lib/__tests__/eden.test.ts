import { vi } from "vitest";

vi.mock("@elysiajs/eden", () => ({
  treaty: vi.fn(() => ({ "hello-world": { get: vi.fn() } })),
}));

vi.stubEnv("VITE_CORE_API_URL", "http://localhost:3000");

describe("eden", () => {
  it("should export an api object with core property", async () => {
    const { api } = await import("../eden");

    expect(api).toBeDefined();
    expect(api.core).toBeDefined();
  });
});
