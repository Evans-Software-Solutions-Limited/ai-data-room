import { render, screen } from "@testing-library/react";
import Login from "../Login";

describe("Login", () => {
  it("should render the login page heading", () => {
    render(<Login />);

    expect(screen.getByText("Login Page")).toBeDefined();
  });

  it("should render the HMR instructions", () => {
    render(<Login />);

    expect(screen.getByText(/Edit/)).toBeDefined();
    expect(screen.getByText("src/App.tsx")).toBeDefined();
  });

  it("should render the docs link text", () => {
    render(<Login />);

    expect(
      screen.getByText("Click on the Vite and React logos to learn more"),
    ).toBeDefined();
  });
});
