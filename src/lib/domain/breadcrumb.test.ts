import { describe, it, expect } from "vitest";
import { buildBreadcrumb } from "./breadcrumb";

describe("buildBreadcrumb", () => {
  it("chưa kết nối", () => {
    expect(buildBreadcrumb({ conn: null })).toBe("Not connected");
    expect(buildBreadcrumb({ conn: "" })).toBe("Not connected");
  });
  it("chỉ connection", () => {
    expect(buildBreadcrumb({ conn: "Local" })).toBe("Local");
  });
  it("connection + db", () => {
    expect(buildBreadcrumb({ conn: "Local", db: "shop" })).toBe("Local \\ shop");
  });
  it("connection + db + coll", () => {
    expect(buildBreadcrumb({ conn: "Local", db: "shop", coll: "users" })).toBe("Local \\ shop \\ users");
  });
  it("coll bị bỏ khi thiếu db", () => {
    expect(buildBreadcrumb({ conn: "Local", coll: "users" })).toBe("Local");
  });
});
