import Elysia, { t } from "elysia";
import { HelloWorldRepositoryService } from "./helloWorldGetService";

export const getHelloWorldHandler = new Elysia()
  .use(HelloWorldRepositoryService)
  .get(
    "/hello-world",
    async (ctx) => {
      const message = await ctx.HelloWorldRepository.get();
      return { message };
    },
    {
      response: {
        200: t.Object({
          message: t.String(),
        }),
      },
    },
  );
