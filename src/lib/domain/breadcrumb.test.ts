import { describe, it, expect } from "vitest";
import { buildBreadcrumb } from "./breadcrumb";

describe("buildBreadcrumb", () => {
  it("no connection → 'Not connected'", () => {
    expect(buildBreadcrumb({ conn: null })).toBe("Not connected");
    expect(buildBreadcrumb({ conn: "" })).toBe("Not connected");
  });
  it("connection only", () => {
    expect(buildBreadcrumb({ conn: "Local" })).toBe("Local");
  });
  it("connection + db", () => {
    expect(buildBreadcrumb({ conn: "Local", db: "shop" })).toBe("Local \\ shop");
  });
  it("connection + db + coll", () => {
    expect(buildBreadcrumb({ conn: "Local", db: "shop", coll: "users" })).toBe("Local \\ shop \\ users");
  });
  it("coll is ignored when db is absent", () => {
    expect(buildBreadcrumb({ conn: "Local", coll: "users" })).toBe("Local");
  });
});
