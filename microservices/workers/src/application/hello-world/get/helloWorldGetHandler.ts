import Elysia, { t } from "elysia";
import { HelloWorldRepositoryService } from "./helloWorldGetService";

export const getHelloWorldHandler = new Elysia()
  .use(HelloWorldRepositoryService)
  .get(
    "/hello-world",
    (ctx) => {
      const helloWorld = ctx.HelloWorldRepository.get();
      return helloWorld;
    },
    {
      response: t.String(),
    },
  );
