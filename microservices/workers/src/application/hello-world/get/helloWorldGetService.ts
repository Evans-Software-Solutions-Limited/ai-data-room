import Elysia from "elysia";
import { HelloWorldRepository } from "../../repositories/helloWorldRepository";

/*
    The service layer acts as a definition layer of the functions that we want to include on this handler.
    Define the repositories to the service that we want to include on this handler.
*/

export const HelloWorldRepositoryService = new Elysia().decorate(
  "HelloWorldRepository",
  new HelloWorldRepository(),
);
