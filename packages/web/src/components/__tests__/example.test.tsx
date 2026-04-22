import { render, screen } from "@testing-library/react";
import { ExampleWrapper, Example } from "../example";

describe("ExampleWrapper", () => {
  it("should render children", () => {
    render(
      <ExampleWrapper>
        <div>Wrapper child</div>
      </ExampleWrapper>,
    );

    expect(screen.getByText("Wrapper child")).toBeDefined();
  });

  it("should apply the example-wrapper data slot", () => {
    const { container } = render(
      <ExampleWrapper>
        <div>Content</div>
      </ExampleWrapper>,
    );

    const wrapper = container.querySelector('[data-slot="example-wrapper"]');
    expect(wrapper).not.toBeNull();
  });

  it("should merge custom className", () => {
    const { container } = render(
      <ExampleWrapper className="custom-class">
        <div>Content</div>
      </ExampleWrapper>,
    );

    const wrapper = container.querySelector('[data-slot="example-wrapper"]');
    expect(wrapper?.className).toContain("custom-class");
  });
});

describe("Example", () => {
  it("should render children", () => {
    render(
      <Example>
        <div>Example child</div>
      </Example>,
    );

    expect(screen.getByText("Example child")).toBeDefined();
  });

  it("should render title when provided", () => {
    render(
      <Example title="My Title">
        <div>Content</div>
      </Example>,
    );

    expect(screen.getByText("My Title")).toBeDefined();
  });

  it("should not render title when not provided", () => {
    const { container } = render(
      <Example>
        <div>Content</div>
      </Example>,
    );

    const titleElement = container.querySelector(".text-muted-foreground");
    expect(titleElement).toBeNull();
  });

  it("should apply the example data slot", () => {
    const { container } = render(
      <Example>
        <div>Content</div>
      </Example>,
    );

    const example = container.querySelector('[data-slot="example"]');
    expect(example).not.toBeNull();
  });
});
