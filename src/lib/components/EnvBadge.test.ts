import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import EnvBadge from "./EnvBadge.svelte";

describe("EnvBadge", () => {
  it("renders the short label with its tone", () => {
    const { getByText } = render(EnvBadge, { props: { env: "prod" } });
    const el = getByText("PROD");
    expect(el.classList.contains("danger")).toBe(true);
  });

  it("renders nothing without an environment", () => {
    const { container } = render(EnvBadge, { props: { env: "" } });
    expect(container.textContent?.trim()).toBe("");
  });
});
