// src/lib/components/MenuBar.test.ts
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/svelte";
import MenuBar from "./MenuBar.svelte";

const base = { connected: true, onsession: vi.fn(), onrefresh: vi.fn(), onquit: vi.fn() };

describe("MenuBar", () => {
  it("Tools → Session manager calls onsession", async () => {
    const onsession = vi.fn();
    const { getByText } = render(MenuBar, { props: { ...base, onsession } });
    await fireEvent.click(getByText("Tools"));
    await fireEvent.click(getByText("Session manager"));
    expect(onsession).toHaveBeenCalled();
  });

  it("File → Refresh calls onrefresh when connected", async () => {
    const onrefresh = vi.fn();
    const { getByText } = render(MenuBar, { props: { ...base, connected: true, onrefresh } });
    await fireEvent.click(getByText("File"));
    await fireEvent.click(getByText("Refresh"));
    expect(onrefresh).toHaveBeenCalled();
  });

  it("File → Refresh is disabled when not connected", async () => {
    const onrefresh = vi.fn();
    const { getByText } = render(MenuBar, { props: { ...base, connected: false, onrefresh } });
    await fireEvent.click(getByText("File"));
    const item = getByText("Refresh") as HTMLButtonElement;
    expect(item.disabled).toBe(true);
  });

  it("View → Language submenu lists both locales with the active one checked", async () => {
    render(MenuBar, { props: { ...base } });
    await fireEvent.click(screen.getByRole("button", { name: "View" }));
    // Locales are nested under a Language submenu, hidden until it is opened.
    expect(screen.queryByRole("button", { name: /English/ })).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Language" }));
    const en = screen.getByRole("button", { name: /English/ });
    expect(en).toBeInTheDocument();
    expect(en.textContent).toContain("✓"); // active locale is checked
    expect(screen.getByRole("button", { name: /Tiếng Việt/ })).toBeInTheDocument();
  });

  it("switching to another locale asks for confirmation before reloading", async () => {
    render(MenuBar, { props: { ...base } });
    await fireEvent.click(screen.getByRole("button", { name: "View" }));
    await fireEvent.click(screen.getByRole("button", { name: "Language" }));
    await fireEvent.click(screen.getByRole("button", { name: "Tiếng Việt" }));
    // A confirm dialog warns about the reload instead of switching abruptly.
    expect(screen.getByText(/will reload to apply Tiếng Việt/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload now" })).toBeInTheDocument();
  });
});
