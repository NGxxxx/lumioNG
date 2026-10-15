import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/svelte";

vi.mock("#lib/api/window.js", () => ({
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  isMaximized: vi.fn().mockResolvedValue(false),
  onMaximizedChange: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("#lib/api/app.js", () => ({ getAppVersion: vi.fn().mockResolvedValue("1.0.0") }));

import TitleBar from "./TitleBar.svelte";

describe("TitleBar", () => {
  it("shows the environment chip before the breadcrumb", () => {
    const { getByText, container } = render(TitleBar, { props: { conn: "prod-cluster", db: null, coll: null, onquit: vi.fn(), env: "prod" } });
    const chip = getByText("PROD");
    const crumb = container.querySelector(".crumb")!;
    expect(chip.compareDocumentPosition(crumb) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("no chip without an environment", () => {
    const { queryByText } = render(TitleBar, { props: { conn: "x", db: null, coll: null, onquit: vi.fn() } });
    expect(queryByText("PROD")).toBeNull();
  });
});
