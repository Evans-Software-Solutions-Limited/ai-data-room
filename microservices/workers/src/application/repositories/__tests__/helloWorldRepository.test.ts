import { HelloWorldRepository } from "../helloWorldRepository";

describe("HelloWorldRepository", () => {
  let repository: HelloWorldRepository;

  beforeEach(() => {
    repository = new HelloWorldRepository();
  });

  describe("static key", () => {
    it("should have the correct static key", () => {
      expect(HelloWorldRepository.key).toBe("HelloWorldRepository");
    });
  });

  describe("get", () => {
    it('should return "Hello, world!"', async () => {
      const result = await repository.get();

      expect(result).toBe("Hello, world!");
    });

    it("should return a string", async () => {
      const result = await repository.get();

      expect(typeof result).toBe("string");
    });
  });

  describe("create", () => {
    it("should return a greeting with the given user name", async () => {
      const result = await repository.create("Alice");

      expect(result).toBe("Hello, Alice!");
    });

    it("should handle empty string user name", async () => {
      const result = await repository.create("");

      expect(result).toBe("Hello, !");
    });

    it("should handle user names with special characters", async () => {
      const result = await repository.create("O'Brien");

      expect(result).toBe("Hello, O'Brien!");
    });
  });
});
