import { getHelloWorldHandler } from "../helloWorldGetHandler";

describe("HelloWorldGetHandler", () => {
  it("should be an Elysia instance", () => {
    expect(getHelloWorldHandler).toBeDefined();
  });

  it("should have a handle method", () => {
    expect(typeof getHelloWorldHandler.handle).toBe("function");
  });

  it("should handle GET /hello-world", async () => {
    const response = await getHelloWorldHandler.handle(
      new Request("http://localhost/hello-world"),
    );

    expect(response.status).toBe(200);
  });
});
