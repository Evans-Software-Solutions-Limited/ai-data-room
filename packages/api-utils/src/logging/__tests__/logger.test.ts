import { describe, it, expect, vi } from "vitest";
import { createLogger, serializeError, injectLambdaContext } from "../logger";

describe("createLogger", () => {
  it("creates a Logger instance with the given service name", () => {
    const logger = createLogger("test-service");
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("creates a Logger instance without a service name", () => {
    const logger = createLogger();
    expect(logger).toBeDefined();
  });
});

describe("serializeError", () => {
  it("serialises an Error instance with name, message, and stack", () => {
    const error = new Error("Something went wrong");
    const result = serializeError(error);

    expect(result.name).toBe("Error");
    expect(result.message).toBe("Something went wrong");
    expect(result.stack).toBeDefined();
    expect(result.stack).toContain("Something went wrong");
  });

  it("serialises a custom error class", () => {
    class ValidationError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "ValidationError";
      }
    }

    const error = new ValidationError("Invalid input");
    const result = serializeError(error);

    expect(result.name).toBe("ValidationError");
    expect(result.message).toBe("Invalid input");
    expect(result.stack).toBeDefined();
  });

  it("serialises a string error", () => {
    const result = serializeError("string error");

    expect(result.name).toBe("UnknownError");
    expect(result.message).toBe("string error");
    expect(result.stack).toBeUndefined();
  });

  it("serialises undefined/null gracefully", () => {
    expect(serializeError(undefined)).toEqual({
      name: "UnknownError",
      message: "undefined",
    });
    expect(serializeError(null)).toEqual({
      name: "UnknownError",
      message: "null",
    });
  });

  it("serialises a number error", () => {
    const result = serializeError(42);

    expect(result.name).toBe("UnknownError");
    expect(result.message).toBe("42");
  });
});

describe("injectLambdaContext", () => {
  it("calls addContext on the logger with the provided context", () => {
    const logger = createLogger("test-service");
    const addContextSpy = vi.spyOn(logger, "addContext");
    const mockContext = {
      functionName: "test-function",
      functionVersion: "$LATEST",
      invokedFunctionArn: "arn:aws:lambda:eu-west-2:123456789:function:test",
      memoryLimitInMB: "256",
      awsRequestId: "test-request-id",
      logGroupName: "/aws/lambda/test",
      logStreamName: "2026/05/20/[$LATEST]abc123",
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: () => {},
      fail: () => {},
      succeed: () => {},
    };

    injectLambdaContext(logger, mockContext);

    expect(addContextSpy).toHaveBeenCalledTimes(1);
    expect(addContextSpy).toHaveBeenCalledWith(mockContext);
  });
});
