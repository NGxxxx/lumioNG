import "@testing-library/jest-dom/vitest";

// jsdom has no ResizeObserver (every real webview does); `bind:clientWidth` needs one to exist.
if (typeof window !== "undefined" && typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
