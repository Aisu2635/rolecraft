import { describe, expect, it } from "vitest";
import { checkManifest, type Manifest } from "../scripts/check-bundle";

const good: Manifest = {
  "index.html": { file: "assets/index-a.js", isEntry: true, imports: ["_react-b.js"] },
  "_react-b.js": { file: "assets/react-b.js" },
  "src/ui/export/exporters.ts": { file: "assets/exporters-c.js", imports: ["_yaml-d.js", "_fflate-e.js"] },
  "_yaml-d.js": { file: "assets/yaml-d.js" },
  "_fflate-e.js": { file: "assets/fflate-e.js" },
};

describe("checkManifest", () => {
  it("passes when yaml and fflate are only behind the dynamic import", () => {
    expect(checkManifest(good)).toEqual({ errors: [], files: ["assets/index-a.js", "assets/react-b.js"] });
  });

  it("fails when the entry statically reaches yaml, even through another chunk", () => {
    const bad: Manifest = { ...good, "_react-b.js": { file: "assets/react-b.js", imports: ["_yaml-d.js"] } };
    expect(checkManifest(bad).errors).toEqual(["assets/yaml-d.js is statically imported by the initial bundle"]);
  });

  it("fails when a lazy chunk is missing from the manifest", () => {
    const { "_fflate-e.js": _gone, ...rest } = good;
    void _gone;
    expect(checkManifest(rest).errors[0]).toContain("assets/fflate-");
  });

  it("fails on a dangling import", () => {
    const bad: Manifest = { ...good, "index.html": { file: "assets/index-a.js", imports: ["_nope.js"] } };
    expect(checkManifest(bad).errors).toEqual(["manifest has no entry for _nope.js"]);
  });
});
