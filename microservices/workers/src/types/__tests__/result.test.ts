import { Result } from "../result";

describe("Result", () => {
  describe("ok", () => {
    it("should create a success result with the given value", () => {
      const result = Result.ok("success");

      expect(result).toEqual({ ok: true, value: "success" });
    });

    it("should have ok set to true", () => {
      const result = Result.ok(42);

      expect(result.ok).toBe(true);
    });

    it("should work with complex types", () => {
      const data = { id: 1, name: "test" };
      const result = Result.ok(data);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(data);
      }
    });
  });

  describe("err", () => {
    it("should create an error result with the given error", () => {
      const result = Result.err("something went wrong");

      expect(result).toEqual({ ok: false, error: "something went wrong" });
    });

    it("should have ok set to false", () => {
      const result = Result.err(new Error("failure"));

      expect(result.ok).toBe(false);
    });

    it("should work with complex error types", () => {
      const error = { code: 404, message: "Not found" };
      const result = Result.err(error);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual(error);
      }
    });
  });

  describe("type narrowing", () => {
    it("should allow accessing value after ok check", () => {
      const result = Result.ok<string, Error>("hello");

      if (result.ok) {
        expect(result.value).toBe("hello");
      } else {
        expect.unreachable("Should be ok");
      }
    });

    it("should allow accessing error after not-ok check", () => {
      const result = Result.err<string, string>("bad");

      if (!result.ok) {
        expect(result.error).toBe("bad");
      } else {
        expect.unreachable("Should be err");
      }
    });
  });
});
