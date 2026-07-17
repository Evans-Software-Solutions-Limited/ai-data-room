import { formatUploaderId } from "../formatUploaderId";

describe("formatUploaderId", () => {
  it("shortens a UUID to its first 8 characters", () => {
    expect(formatUploaderId("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(
      "a1b2c3d4",
    );
  });
});
