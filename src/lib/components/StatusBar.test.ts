// src/lib/components/StatusBar.test.ts
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import StatusBar from "./StatusBar.svelte";

describe("StatusBar", () => {
  it("hiện selDb + collCount khi connected và có selDb", () => {
    const { getByText } = render(StatusBar, {
      props: { connected: true, connectionLabel: "Local", dbCount: 2, collCount: 5, selDb: "shop", selColl: "users" },
    });
    // Segment 1: selDb takes precedence over connectionLabel
    expect(getByText(/shop · 5 collections/)).toBeTruthy();
    // Placeholder segments must show em-dash, not fabricated numbers
    expect(getByText("—:—")).toBeTruthy();
    expect(getByText("Idle.")).toBeTruthy();
  });

  it("hiện connectionLabel khi connected nhưng chưa chọn db", () => {
    const { getByText } = render(StatusBar, {
      props: { connected: true, connectionLabel: "Local", dbCount: 2, collCount: 3, selDb: null, selColl: null },
    });
    expect(getByText(/Local · 3 collections/)).toBeTruthy();
  });

  it("hiện Disconnected khi chưa kết nối", () => {
    const { getByText } = render(StatusBar, {
      props: { connected: false, connectionLabel: null, dbCount: 0, collCount: 0, selDb: null, selColl: null },
    });
    expect(getByText("Disconnected")).toBeTruthy();
  });
});
