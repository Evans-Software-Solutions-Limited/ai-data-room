import { HelloWorldRepositoryService } from "../helloWorldGetService";

describe("HelloWorldGetService", () => {
  it("should be an Elysia instance", () => {
    expect(HelloWorldRepositoryService).toBeDefined();
  });

  it("should decorate with HelloWorldRepository", () => {
    const app = HelloWorldRepositoryService;

    expect(app).toHaveProperty("use");
  });
});
