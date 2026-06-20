import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import HostTab from "./HostTab.svelte";

describe("HostTab", () => {
  it("hiện tên connection + ghi chú placeholder", () => {
    const { getByText } = render(HostTab, { props: { connection: { label: "local MongoDB", uri: "mongodb://localhost:27017" } } });
    expect(getByText("local MongoDB")).toBeTruthy();
    expect(getByText(/serverStatus/)).toBeTruthy();
  });
});
