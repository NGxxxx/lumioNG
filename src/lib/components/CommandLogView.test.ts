import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/svelte";
import { commandLog } from "../stores/commandLog.svelte";
import CommandLogView from "./CommandLogView.svelte";

describe("CommandLogView", () => {
  beforeEach(() => commandLog.clear());
  it("renders each command entry", () => {
    commandLog.push("db.test.find({})");
    const { getByText } = render(CommandLogView);
    expect(getByText("db.test.find({})")).toBeTruthy();
  });
});
