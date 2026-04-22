import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { ComponentExample } from "../component-example";

vi.mock("@/hooks/api/useGetHelloWorld", () => ({
  useGetHelloWorld: vi.fn(() => ({
    isLoading: false,
    data: { message: "Hello, world!" },
    error: null,
  })),
}));

describe("ComponentExample", () => {
  it("should render without crashing", () => {
    render(<ComponentExample />);

    expect(screen.getByText("Home")).toBeDefined();
    expect(screen.getByText("Form")).toBeDefined();
  });

  it("should display the hello world message", () => {
    render(<ComponentExample />);

    expect(screen.getByText("Hello, world!")).toBeDefined();
  });

  it("should render the form with user information fields", () => {
    render(<ComponentExample />);

    expect(screen.getByText("User Information")).toBeDefined();
  });

  it("should render submit and cancel buttons", () => {
    render(<ComponentExample />);

    expect(screen.getByText("Submit")).toBeDefined();
    expect(screen.getByText("Cancel")).toBeDefined();
  });

  it("should show loading state when data is loading", async () => {
    const { useGetHelloWorld } = await import("@/hooks/api/useGetHelloWorld");
    vi.mocked(useGetHelloWorld).mockReturnValue({
      isLoading: true,
      data: undefined,
      error: null,
    } as ReturnType<typeof useGetHelloWorld>);

    render(<ComponentExample />);

    expect(screen.getByText("Loading...")).toBeDefined();
  });
});
