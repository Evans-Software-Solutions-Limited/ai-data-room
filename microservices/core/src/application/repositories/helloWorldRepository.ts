export class HelloWorldRepository {
  static readonly key = "HelloWorldRepository";
  async get(): Promise<string> {
    /*
            Repository Layer is where we interact with the database or external services
        */
    return `Hello, world!`;
  }
  async create(user: string): Promise<string> {
    return `Hello, ${user}!`;
  }
}
