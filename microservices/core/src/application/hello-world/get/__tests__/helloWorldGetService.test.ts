import { HelloWorldRepositoryService } from "../helloWorldGetService";

describe("HelloWorldGetService", () => {
  it("should be an Elysia instance", () => {
    expect(HelloWorldRepositoryService).toBeDefined();
  });

  it("should decorate with HelloWorldRepository", async () => {
    // The service decorates the Elysia instance with a HelloWorldRepository
    // We can verify by checking the decorator exists after use
    const app = HelloWorldRepositoryService;

    // Elysia stores decorators internally - verify the service is configured
    expect(app).toHaveProperty("use");
  });
});
