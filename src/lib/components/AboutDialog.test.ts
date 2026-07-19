import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/svelte";

vi.mock("$lib/api/app", () => ({ getAppVersion: vi.fn().mockResolvedValue("0.2.0") }));

import AboutDialog from "./AboutDialog.svelte";
import { handleModalKeydown } from "$lib/stores/modalStack";

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
});
