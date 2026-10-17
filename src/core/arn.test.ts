import { describe, expect, it } from "vitest";
import ec2Raw from "./__fixtures__/aws/ec2.json";
import logsRaw from "./__fixtures__/aws/logs.json";
import s3Raw from "./__fixtures__/aws/s3.json";
import lambdaRaw from "../../public/data/svc/lambda.json";
import { classifyArn, fillArn, matchableTypes } from "./arn";
import type { SlimService } from "./types";
import { toSlimService } from "./catalog/transform";

const s3 = toSlimService(s3Raw);
const logs = toSlimService(logsRaw);
const ec2 = toSlimService(ec2Raw);

describe("fillArn", () => {
  it("fills partition and named values", () => {
    expect(
      fillArn(
        "arn:${Partition}:s3:::${BucketName}",
        { BucketName: "data-lake" },
        { partition: "aws" },
      ),
    ).toBe("arn:aws:s3:::data-lake");
  });

  it("substitutes * for missing account, region and values", () => {
    expect(
      fillArn(
        "arn:${Partition}:logs:${Region}:${Account}:log-group:${LogGroupName}",
        { LogGroupName: "/aws/lambda/x" },
        { partition: "aws" },
      ),
    ).toBe("arn:aws:logs:*:*:log-group:/aws/lambda/x");
    expect(
      fillArn("arn:${Partition}:s3:::${BucketName}", {}, { partition: "aws" }),
    ).toBe("arn:aws:s3:::*");
  });

  it("uses context region and account when given", () => {
    expect(
      fillArn(
        "arn:${Partition}:ec2:${Region}:${Account}:instance/${InstanceId}",
        { InstanceId: "i-1" },
        { partition: "aws", region: "eu-west-1", accountId: "123456789012" },
      ),
    ).toBe("arn:aws:ec2:eu-west-1:123456789012:instance/i-1");
  });
});

describe("classifyArn", () => {
  it("classifies an S3 bucket ARN", () => {
    expect(classifyArn("arn:aws:s3:::data-lake", s3)).toEqual(["bucket"]);
  });

  it("classifies an S3 object ARN and not as bucket", () => {
    const r = classifyArn("arn:aws:s3:::data-lake/reports/*", s3);
    expect(r).toContain("object");
    expect(r).not.toContain("bucket");
  });

  it("classifies a log group ARN with wildcard suffix", () => {
    expect(
      classifyArn(
        "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/x:*",
        logs,
      ),
    ).toContain("log-group");
  });

  it("classifies an EC2 instance ARN", () => {
    expect(
      classifyArn("arn:aws:ec2:us-east-1:123456789012:instance/i-0abc", ec2),
    ).toEqual(["instance"]);
  });

  it("returns [] for non-matching service and for *", () => {
    expect(classifyArn("arn:aws:s3:::data-lake", ec2)).toEqual([]);
    expect(classifyArn("*", s3)).toEqual([]);
  });

  it("accepts wildcard region/account and empty account", () => {
    expect(classifyArn("arn:aws:ec2:*:*:instance/*", ec2)).toEqual([
      "instance",
    ]);
    expect(classifyArn("arn:aws:ec2:us-east-1::image/ami-1", ec2)).toEqual([
      "image",
    ]);
  });

  it("rejects other partitions and malformed accounts", () => {
    expect(classifyArn("arn:aws-cn:s3:::data-lake", s3)).toEqual([]);
    expect(classifyArn("arn:aws:ec2:us-east-1:123:instance/i-1", ec2)).toEqual(
      [],
    );
  });

  it("returns sorted names on ties and is stable across calls (cache)", () => {
    const a = classifyArn("arn:aws:s3:::b/k", s3);
    expect(a).toEqual([...a].sort());
    expect(classifyArn("arn:aws:s3:::b/k", s3)).toEqual(a);
  });

  it("escapes regex metacharacters in literal text", () => {
    const svc = {
      key: "x",
      name: "X",
      category: "c",
      actions: [],
      conditionKeys: [],
      resources: [
        {
          name: "dot",
          arnFormats: ["arn:${Partition}:x:::a.b"],
          conditionKeys: [],
        },
        {
          name: "multi",
          arnFormats: [
            "arn:${Partition}:x:::q?${N}",
            "arn:${Partition}:x:::zz",
          ],
          conditionKeys: [],
        },
      ],
    } as unknown as Parameters<typeof classifyArn>[1];
    expect(classifyArn("arn:aws:x:::a.b", svc)).toEqual(["dot"]);
    expect(classifyArn("arn:aws:x:::aXb", svc)).toEqual([]);
    expect(classifyArn("arn:aws:x:::q?foo", svc)).toEqual(["multi"]);
  });
});

describe("classifyArn robustness", () => {
  const svc = {
    key: "svc",
    name: "Svc",
    category: "c",
    actions: [],
    conditionKeys: [],
    resources: [
      {
        name: "snap",
        arnFormats: [
          "arn:${Partition}:svc:${Region}:${Account}:catalog/${A}/engagement/${B}/resource/${C}/${D}/template/${E}/${F}",
          "short",
        ],
        conditionKeys: [],
      },
    ],
  } as unknown as Parameters<typeof classifyArn>[1];

  it("is not vulnerable to ReDoS on near-miss input", () => {
    const input =
      "arn:aws:svc:us-east-1:123456789012:catalog/" +
      "a/engagement/a/resource/a/a/template/".repeat(82) +
      "x";
    expect(input.length).toBeGreaterThan(2900);
    const t0 = performance.now();
    const r = classifyArn(input, svc);
    const ms = performance.now() - t0;
    expect(r).toEqual([]);
    expect(ms).toBeLessThan(50);
  });

  it("is fast on a near-miss that stays under the length cap", () => {
    const input =
      "arn:aws:svc:us-east-1:123456789012:catalog/" +
      "a/engagement/a/resource/a/a/template/".repeat(50) +
      "x";
    const t0 = performance.now();
    classifyArn(input, svc);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("matches a valid ARN for the many-placeholder format", () => {
    expect(
      classifyArn(
        "arn:aws:svc:us-east-1:123456789012:catalog/1/engagement/2/resource/3/4/template/5/6",
        svc,
      ),
    ).toEqual(["snap"]);
  });

  it("rejects ARNs longer than 2048 characters", () => {
    expect(classifyArn("arn:aws:s3:::" + "a".repeat(2035), s3)).toEqual([
      "bucket",
    ]);
    expect(classifyArn("arn:aws:s3:::" + "a".repeat(2036), s3)).toEqual([]);
  });

  it("rejects ARNs with too few fields or wrong prefix", () => {
    expect(classifyArn("arn:aws:s3:::", s3)).toEqual([]);
    expect(classifyArn("arn:aws:s3", s3)).toEqual([]);
    expect(classifyArn("urn:aws:s3:::b", s3)).toEqual([]);
  });
});

describe("matchableTypes", () => {
  const logs = toSlimService(logsRaw);
  const lambda = lambdaRaw as unknown as SlimService;
  const LG = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/fn";

  it("delegates to classifyArn for concrete ARNs", () => {
    expect(matchableTypes("arn:aws:s3:::b/k", s3)).toEqual(classifyArn("arn:aws:s3:::b/k", s3));
    expect(matchableTypes("not-an-arn", s3)).toEqual([]);
  });
  it("handles wildcard ARNs over log groups", () => {
    const t = matchableTypes(LG + ":*", logs);
    expect(t).toContain("log-stream");
    expect(t).not.toContain("log-group");
    const all = matchableTypes("arn:aws:logs:*:*:*", logs);
    expect(all).toEqual(expect.arrayContaining(["log-group", "log-stream"]));
    expect(matchableTypes(LG, logs)).toEqual(["log-group"]);
  });
  it("handles wildcard ARNs over s3", () => {
    const o = matchableTypes("arn:aws:s3:::b/*", s3);
    expect(o).toContain("object");
    expect(o).not.toContain("bucket");
    expect(matchableTypes("arn:aws:s3:::*", s3)).toEqual(expect.arrayContaining(["bucket", "object"]));
    expect(matchableTypes("arn:aws:s3:::b?", s3)).toContain("bucket");
  });
  it("handles wildcard ARNs over lambda", () => {
    const t = matchableTypes("arn:aws:lambda:us-east-1:123456789012:function:f:*", lambda);
    expect(t).toEqual(expect.arrayContaining(["function alias", "function version"]));
    expect(t).toContain("function");
  });
  it("covers short trailing-star ARNs and rejects bad ones", () => {
    expect(matchableTypes("arn:aws:logs:*", logs)).toEqual(expect.arrayContaining(["log-group"]));
    expect(matchableTypes("arn:aws:logs:us-east-1", logs)).toEqual([]);
    expect(matchableTypes("urn:aws:logs:*:*:*", logs)).toEqual([]);
    expect(matchableTypes("arn:aws:s3:::" + "*".repeat(3000), s3)).toEqual([]);
  });
  it("checks header fields", () => {
    expect(matchableTypes("arn:aws:ec2:*:*:*", logs)).toEqual([]);
    expect(matchableTypes("arn:gov:logs:*:*:*", logs)).toEqual([]);
    expect(matchableTypes("arn:*:logs:*:*:*", logs)).toContain("log-group");
    expect(matchableTypes("arn:aws:logs:us-east-1:notanaccount:*", logs)).toEqual([]);
  });
  it("is fast on adversarial wildcard ARNs", () => {
    const adv = "arn:aws:logs:*:*:" + "*a".repeat(997) + "?";
    matchableTypes("arn:aws:logs:*:*:*", logs); // warm format cache
    matchableTypes("arn:aws:lambda:*:*:*", lambda);
    const best = Math.min(
      ...[0, 1, 2].map(() => {
        const start = performance.now();
        matchableTypes(adv, logs);
        matchableTypes("arn:aws:lambda:*:*:" + "*a?".repeat(660), lambda);
        return performance.now() - start;
      }),
    ); // best of 3 to absorb CI scheduling noise
    expect(best).toBeLessThan(50);
  });
});
