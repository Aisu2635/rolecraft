import { describe, expect, it } from "vitest";
import { parseDocument } from "./schema";

const ok = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "s3:GetObject", Resource: "*" }] };
const ids = (d: unknown) => parseDocument(d).issues.map((i) => i.id);

describe("parseDocument", () => {
  it("accepts a valid doc", () => {
    const r = parseDocument(ok);
    expect(r.issues).toEqual([]);
    expect(r.statements).toHaveLength(1);
  });
  it.each([null, 5, "x", [], undefined])("rejects non-object doc %j", (d) => expect(ids(d)).toEqual(["V_SCHEMA"]));
  it("flags missing Version and Statement", () => {
    const r = parseDocument({});
    expect(r.issues.map((i) => i.path)).toEqual(["Version", "Statement"]);
  });
  it("flags wrong version", () => expect(ids({ ...ok, Version: "2008-10-17" })).toEqual(["V_VERSION"]));
  it("flags non-array statement and unknown top-level keys, allows Id", () => {
    expect(ids({ Version: "2012-10-17", Statement: {} })).toEqual(["V_SCHEMA"]);
    expect(ids({ ...ok, Foo: 1 })).toEqual(["V_SCHEMA"]);
    expect(ids({ ...ok, Id: "x" })).toEqual([]);
  });
  it("flags empty statements", () => expect(ids({ Version: "2012-10-17", Statement: [] })).toEqual(["V_EMPTY_STATEMENTS"]));
  it("flags structural failures with paths and skips the statement", () => {
    const r = parseDocument({ Version: "2012-10-17", Statement: [ok.Statement[0], { Action: "s3:Get", Resource: "*" }, "x"] });
    expect(r.issues.map((i) => [i.id, i.path])).toEqual([
      ["V_SCHEMA", "Statement[1].Effect"],
      ["V_SCHEMA", "Statement[2]"],
    ]);
    expect(r.statements.map((s) => s.index)).toEqual([0]);
  });
  it("rejects empty arrays, non-string entries, unknown keys, bad conditions", () => {
    const bad = (s: unknown) => ids({ Version: "2012-10-17", Statement: [s] });
    expect(bad({ Effect: "Allow", Action: [], Resource: "*" })).toEqual(["V_SCHEMA"]);
    expect(bad({ Effect: "Allow", Action: [1], Resource: "*" })).toEqual(["V_SCHEMA"]);
    expect(bad({ Effect: "Allow", Action: "s3:Get", NotResource: "*" })).toEqual(["V_SCHEMA"]);
    expect(bad({ Effect: "Allow", NotAction: "s3:Get", Resource: "*" }).length).toBeGreaterThan(0);
    expect(bad({ Effect: "Allow", Action: "s3:Get", Resource: "*", Condition: { StringEquals: 1 } })).toEqual(["V_SCHEMA"]);
  });
  it("checks sid format and duplicates", () => {
    const st = (Sid: string) => ({ Sid, Effect: "Allow", Action: "s3:Get*", Resource: "*" });
    expect(ids({ Version: "2012-10-17", Statement: [st("Has Space")] })).toEqual(["V_SID_FORMAT"]);
    expect(ids({ Version: "2012-10-17", Statement: [st("A"), st("A")] })).toEqual(["V_SID_DUPLICATE"]);
    expect(ids({ Version: "2012-10-17", Statement: [st(""), st("")] })).toEqual([]);
  });
});
