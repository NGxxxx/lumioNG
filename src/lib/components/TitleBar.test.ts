import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/svelte";

vi.mock("#lib/stores/desktop.js", () => ({
  windowControls: {
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(false),
    onMaximizedChange: vi.fn().mockResolvedValue(() => {}),
  },
  appVersion: vi.fn().mockResolvedValue("1.0.0"),
}));

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

  it("hides_window_buttons_when_native_frame", () => {
    const custom = render(TitleBar, { props: { conn: null, db: null, coll: null, onquit: vi.fn() } });
    expect(custom.container.querySelector(".wbtns")).not.toBeNull();
    expect(custom.getByLabelText("Close")).toBeTruthy();
    custom.unmount();
    const native = render(TitleBar, { props: { conn: null, db: null, coll: null, onquit: vi.fn(), nativeFrame: true } });
    expect(native.container.querySelector(".wbtns")).toBeNull();
    expect(native.queryByLabelText("Close")).toBeNull();
    expect(native.queryByLabelText("Minimize")).toBeNull();
  });
});
