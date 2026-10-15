// src/lib/components/StatusBar.test.ts
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import StatusBar from "./StatusBar.svelte";

describe("StatusBar", () => {
  it("shows selDb + collCount when connected and selDb is set", () => {
    const { getByText } = render(StatusBar, {
      props: { connected: true, connectionLabel: "Local", dbCount: 2, collCount: 5, selDb: "shop", selColl: "users" },
    });
    // Segment 1: selDb takes precedence over connectionLabel
    expect(getByText(/shop · 5 collections/)).toBeTruthy();
    // No connectedAt prop → connected-time clock shows em-dash, not a fabricated value
    expect(getByText("Connected: —")).toBeTruthy();
    // No activity in progress → idle label
    expect(getByText("Idle.")).toBeTruthy();
  });

  it("shows the activity label instead of Idle when one is in progress", () => {
    const { getByText, queryByText } = render(StatusBar, {
      props: {
        connected: true, connectionLabel: "Local", dbCount: 1, collCount: 1,
        selDb: "shop", selColl: null, activityLabel: "Running query…",
      },
    });
    expect(getByText("Running query…")).toBeTruthy();
    expect(queryByText("Idle.")).toBeNull();
  });

  it("shows connectionLabel when connected but no db selected", () => {
    const { getByText } = render(StatusBar, {
      props: { connected: true, connectionLabel: "Local", dbCount: 2, collCount: 3, selDb: null, selColl: null },
    });
    expect(getByText(/Local · 3 collections/)).toBeTruthy();
  });

  it("shows Disconnected when not connected", () => {
    const { getByText } = render(StatusBar, {
      props: { connected: false, connectionLabel: null, dbCount: 0, collCount: 0, selDb: null, selColl: null },
    });
    expect(getByText("Disconnected")).toBeTruthy();
  });

  it("shows server version and formatted uptime when provided", () => {
    const { getByText } = render(StatusBar, {
      props: {
        connected: true,
        connectionLabel: "local",
        dbCount: 1,
        collCount: 2,
        selDb: "shop",
        selColl: null,
        version: "7.0.5",
        uptimeSeconds: 3725,
        serverTimeIso: "2023-11-14T22:13:20.000Z",
      },
    });
    expect(getByText("MongoDB 7.0.5")).toBeTruthy();
    expect(getByText("Uptime: 1h 2m")).toBeTruthy();
  });

  it("has a Command log toggle showing the unseen count, which calls ontogglelog", async () => {
    const ontogglelog = vi.fn();
    const { getByRole } = render(StatusBar, {
      props: { connected: true, connectionLabel: "L", dbCount: 1, collCount: 1, selDb: null, selColl: null, logOpen: false, logUnseen: 2, ontogglelog },
    });
    const btn = getByRole("button", { name: "Command log" });
    expect(btn.getAttribute("data-unseen")).toBe("2");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    await fireEvent.click(btn);
    expect(ontogglelog).toHaveBeenCalled();
  });

  it("hides the unseen dot when there is nothing new", () => {
    const { getByRole, container } = render(StatusBar, {
      props: { connected: true, connectionLabel: "L", dbCount: 1, collCount: 1, selDb: null, selColl: null, logOpen: true, logUnseen: 0, ontogglelog: vi.fn() },
    });
    expect(getByRole("button", { name: "Command log" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".log-dot")).toBeNull();
  });
});
