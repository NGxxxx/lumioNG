import { describe, it, expect } from "vitest";
import { infoText, platformLabel, webviewName } from "./aboutInfo";

describe("aboutInfo", () => {
  it("platform labels read like people say them", () => {
    expect(platformLabel("windows", "x86_64")).toBe("Windows · x64");
    expect(platformLabel("macos", "aarch64")).toBe("macOS · ARM64");
    expect(platformLabel("freebsd", "riscv64")).toBe("freebsd · riscv64");
  });
  it("names the webview engine per OS", () => {
    expect(webviewName("windows")).toBe("WebView2");
    expect(webviewName("linux")).toBe("WebKit");
  });
  it("copy text lists every fact on its own line", () => {
    const text = infoText({ version: "0.2.0", commit: "d4ca0af", buildDate: "2026-10-15", os: "windows", arch: "x86_64", webview: null });
    expect(text).toBe("LumioNG 0.2.0\nBuild: d4ca0af (2026-10-15)\nPlatform: Windows · x64\nWebView2: unknown");
  });
});
