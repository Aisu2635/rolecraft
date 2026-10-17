import { describe, expect, it, vi } from "vitest";
import s3 from "../__fixtures__/aws/s3.json";
import ec2 from "../__fixtures__/aws/ec2.json";
import { createLoader } from "./loader";
import { buildIndex, toSlimService } from "./transform";

const slim = { s3: toSlimService(s3), ec2: toSlimService(ec2) };

function fake() {
  return vi.fn(async (path: string): Promise<unknown> => {
    const m = /^\/data\/svc\/(.+)\.json$/.exec(path);
    if (m) return slim[m[1] as keyof typeof slim];
    if (path === "/data/index.json")
      return buildIndex(Object.values(slim), "2026-01-01");
    throw new Error("404");
  });
}

describe("createLoader", () => {
  it("memoizes loadService", async () => {
    const f = fake();
    const l = createLoader(f);
    await l.loadService("s3");
    await l.loadService("s3");
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith("/data/svc/s3.json");
  });
  it("does not cache a failed load", async () => {
    const f = fake();
    f.mockRejectedValueOnce(new Error("net"));
    const l = createLoader(f);
    await expect(l.loadService("s3")).rejects.toThrow("net");
    await expect(l.loadService("s3")).resolves.toMatchObject({ key: "s3" });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("loads the index once", async () => {
    const f = fake();
    const l = createLoader(f);
    const a = await l.loadIndex();
    await l.loadIndex();
    expect(a.services).toHaveLength(2);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith("/data/index.json");
  });
  it("loadServices returns a catalog", async () => {
    const l = createLoader(fake());
    const c = await l.loadServices(["s3", "ec2"]);
    expect(c.hasService("s3")).toBe(true);
    expect(c.hasService("ec2")).toBe(true);
  });
  it.each(["../x", "S3", "a/b", "", "a".repeat(65), "s3?x=1", "a b", "%2e%2e"])("rejects unsafe key %j without fetching", async (key) => {
    const f = fake();
    const l = createLoader(f);
    await expect(l.loadService(key)).rejects.toThrow(/Invalid service key/);
    await expect(l.loadServices(["s3", key])).rejects.toThrow(/Invalid service key/);
    expect(f).not.toHaveBeenCalledWith(expect.stringContaining(key === "" ? "/data/svc/.json" : "svc/" + key));
  });
  it("accepts keys with digits and hyphens", async () => {
    const f = fake();
    await createLoader(f).loadService("s3").catch(() => undefined);
    expect(f).toHaveBeenCalledWith("/data/svc/s3.json");
  });
});
