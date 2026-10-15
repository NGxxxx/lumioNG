import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";

const copied: string[] = [];
const opened: string[] = [];
vi.mock("#lib/api/app.js", () => ({
  openExternalUrl: vi.fn(async (u: string) => void opened.push(u)),
  getAppVersion: vi.fn().mockResolvedValue("0.2.0"),
  getAppInfo: vi.fn().mockResolvedValue({
    version: "0.2.0", commit: "d4ca0af", buildDate: "2026-10-15", os: "windows", arch: "x86_64", webview: "130.0.2849.80",
  }),
}));
vi.mock("#lib/stores/clipboardCopy.js", () => ({ createClipboardCopy: () => async (t: string) => void copied.push(t) }));

import AboutDialog from "./AboutDialog.svelte";
import { handleModalKeydown } from "#lib/stores/modalStack.js";

function key(k: string): KeyboardEvent {
  return { key: k, target: null } as unknown as KeyboardEvent;
}

describe("AboutDialog", () => {
  it("Escape calls onclose", () => {
    const onclose = vi.fn();
    render(AboutDialog, { props: { onclose } });
    handleModalKeydown(key("Escape"));
    expect(onclose).toHaveBeenCalled();
  });

  it("Enter calls onclose", () => {
    const onclose = vi.fn();
    render(AboutDialog, { props: { onclose } });
    handleModalKeydown(key("Enter"));
    expect(onclose).toHaveBeenCalled();
  });

  it("shows the build facts and copies them as one block", async () => {
    const { findByText, getByText, getByRole } = render(AboutDialog, { props: { onclose: vi.fn() } });
    expect(await findByText("d4ca0af · 2026-10-15")).toBeTruthy();
    expect(getByText("Windows · x64")).toBeTruthy();
    expect(getByText("WebView2")).toBeTruthy();
    expect(getByText("130.0.2849.80")).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "Copy info" }));
    expect(copied.at(-1)).toBe("LumioNG 0.2.0\nBuild: d4ca0af (2026-10-15)\nPlatform: Windows · x64\nWebView2: 130.0.2849.80");
    expect(getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("opens the GitHub repository in the system browser", async () => {
    const { getByRole } = render(AboutDialog, { props: { onclose: vi.fn() } });
    await fireEvent.click(getByRole("link", { name: "github.com/NGxxxx/lumioNG" }));
    expect(opened.at(-1)).toBe("https://github.com/NGxxxx/lumioNG");
  });

  it("opens the donation pages in the system browser", async () => {
    const { getByRole } = render(AboutDialog, { props: { onclose: vi.fn() } });
    await fireEvent.click(getByRole("link", { name: "GitHub Sponsors" }));
    expect(opened.at(-1)).toBe("https://github.com/sponsors/NGxxxx");
    await fireEvent.click(getByRole("link", { name: "Ko-fi" }));
    expect(opened.at(-1)).toBe("https://ko-fi.com/ngxxxx");
  });
});
