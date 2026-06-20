import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import QueryTab from "./QueryTab.svelte";

describe("QueryTab", () => {
  it("hiện db.coll + ghi chú aggregate", () => {
    const { container } = render(QueryTab, { props: { db: "shop", coll: "orders" } });
    expect(container.textContent).toContain("shop.orders");
    expect(container.textContent).toContain("Aggregate");
  });
});
