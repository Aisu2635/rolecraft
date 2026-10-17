import { describe, expect, it } from "vitest";
import { validateList } from "../scripts/sync-aws-data";

const H = "https://servicereference.us-east-1.amazonaws.com";
const ok = (service: string) => ({ service, url: `${H}/v1/${service}/${service}.json` });

describe("sync list validation", () => {
  it("accepts a good list", () => {
    expect(validateList([ok("s3"), ok("ec2")])).toHaveLength(2);
  });
  it.each([
    ["not an array", {}],
    ["bad key", [ok("S3")]],
    ["path key", [{ service: "../x", url: `${H}/x` }]],
    ["http url", [{ service: "s3", url: `${H.replace("https", "http")}/x` }]],
    ["other host", [{ service: "s3", url: "https://evil.example.com/x" }]],
    ["host suffix trick", [{ service: "s3", url: `${H}.evil.com/x` }]],
    ["malformed entry", [null]],
    ["duplicate", [ok("s3"), ok("s3")]],
  ])("rejects %s", (_n, list) => {
    expect(() => validateList(list)).toThrow();
  });
});
