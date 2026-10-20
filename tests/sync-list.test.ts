import { describe, expect, it } from "vitest";
import { validateList } from "../scripts/sync-aws-data";

const H = "https://servicereference.us-east-1.amazonaws.com";
const ok = (service: string) => ({ service, url: `${H}/v1/${service}/${service}.json` });
const badUrl = `Service "s3" url must start with ${H}/`;

describe("sync list validation", () => {
  it("accepts a good list", () => {
    expect(validateList([ok("s3"), ok("ec2")])).toHaveLength(2);
  });
  it.each([
    ["not an array", {}, "Unexpected service list shape"],
    ["bad key", [ok("S3")], "Service list entry 0 has an invalid service key"],
    ["path key", [{ service: "../x", url: `${H}/x` }], "Service list entry 0 has an invalid service key"],
    ["http url", [{ service: "s3", url: `${H.replace("https", "http")}/x` }], badUrl],
    ["other host", [{ service: "s3", url: "https://evil.example.com/x" }], badUrl],
    ["host suffix trick", [{ service: "s3", url: `${H}.evil.com/x` }], badUrl],
    ["malformed entry", [null], "Service list entry 0 is malformed"],
    ["duplicate", [ok("s3"), ok("s3")], 'Duplicate service key "s3" in service list'],
  ])("rejects %s", (_n, list, message) => {
    expect(() => validateList(list)).toThrow(message);
  });
});
