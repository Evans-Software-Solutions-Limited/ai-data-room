import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import Home from "../Home";
import { useGetHelloWorld } from "@/hooks/api/useGetHelloWorld";
import type { UseQueryResult } from "@tanstack/react-query";

vi.mock("@/hooks/api/useGetHelloWorld");

const mockUseGetHelloWorld = vi.mocked(useGetHelloWorld);

describe("Home", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should render when data is loaded", () => {
    mockUseGetHelloWorld.mockReturnValue({
      isLoading: false,
      data: { message: "Hello, world!" },
      error: null,
    } as unknown as UseQueryResult<{ message: string }>);

    render(<Home />);

    expect(screen.getByText("Home")).toBeDefined();
  });

  it("should show loading state", () => {
    mockUseGetHelloWorld.mockReturnValue({
      isLoading: true,
      data: undefined,
      error: null,
    } as unknown as UseQueryResult<{ message: string }>);

    render(<Home />);

    expect(screen.getByText("Loading...")).toBeDefined();
  });

  it("should display the message from the API", () => {
    mockUseGetHelloWorld.mockReturnValue({
      isLoading: false,
      data: { message: "Hello, world!" },
      error: null,
    } as unknown as UseQueryResult<{ message: string }>);

    render(<Home />);

    expect(screen.getByText("Hello, world!")).toBeDefined();
  });
});
