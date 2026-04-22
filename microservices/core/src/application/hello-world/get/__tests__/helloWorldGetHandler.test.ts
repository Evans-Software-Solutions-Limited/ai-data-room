import { getHelloWorldHandler } from "../helloWorldGetHandler";

describe("HelloWorldGetHandler", () => {
  it("should be an Elysia instance", () => {
    expect(getHelloWorldHandler).toBeDefined();
  });

  it("should handle GET /hello-world and return a message", async () => {
    const response = await getHelloWorldHandler.handle(
      new Request("http://localhost/hello-world"),
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as { message: string };
    expect(body).toHaveProperty("message");
    expect(body.message).toBe("Hello, world!");
  });
});
