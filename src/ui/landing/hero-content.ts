// Static content for the landing hero. Deliberately has no engine imports: the policy below is pinned to the
// real generator output by hero-content.test.ts, so it can never drift without a failing test.

export const HAND_WRITTEN_JSON = '{\n  "Effect": "Allow",\n  "Action": "s3:*",\n  "Resource": "*"\n}';

export const HERO_SENTENCE = {
  who: "analytics-team",
  verb: "list + read",
  scope: "data-lake / reports/",
};

/** Exact `stringifyPolicy` output for the analytics-reader model (pinned by test). */
export const HERO_POLICY_JSON = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3ListReadList",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::data-lake",
      "Condition": {
        "StringLike": {
          "s3:prefix": [
            "reports/",
            "reports/*"
          ]
        }
      }
    },
    {
      "Sid": "S3ListReadObjects",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:GetObjectVersion"
      ],
      "Resource": "arn:aws:s3:::data-lake/reports/*"
    }
  ]
}
`;

const MAX_INLINE = 56;

function inline(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`;
  if (v && typeof v === "object") {
    const parts = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`);
    return `{ ${parts.join(", ")} }`;
  }
  return JSON.stringify(v);
}

/** Lines for `"key": value`, expanding objects that would be too wide for the card. */
function entry(key: string, v: unknown): string[] {
  const head = `${JSON.stringify(key)}: `;
  const flat = inline(v);
  if (flat.length <= MAX_INLINE || !v || typeof v !== "object" || Array.isArray(v)) return [head + flat];
  const kids = Object.entries(v).map(([k, x]) => entry(k, x));
  const out = [`${head}{`];
  kids.forEach((g, i) => {
    g.forEach((l, j) => out.push(`  ${l}${j === g.length - 1 && i < kids.length - 1 ? "," : ""}`));
  });
  out.push("}");
  return out;
}

/** Compact, human-sized rendering of HERO_POLICY_JSON's statements (Sid omitted); valid JSON inside `[ ]`. */
export function heroPolicyLines(): string[] {
  const doc = JSON.parse(HERO_POLICY_JSON) as { Statement: Record<string, unknown>[] };
  const lines: string[] = [];
  doc.Statement.forEach((st, si) => {
    const groups = Object.entries(st)
      .filter(([k]) => k !== "Sid")
      .map(([k, v]) => entry(k, v));
    groups.forEach((g, gi) => {
      const lastGroup = gi === groups.length - 1;
      g.forEach((l, li) => {
        let text = (gi === 0 && li === 0 ? "{ " : "  ") + l;
        if (li === g.length - 1) {
          text += lastGroup ? (si === doc.Statement.length - 1 ? " }" : " },") : ",";
        }
        lines.push(text);
      });
    });
  });
  return lines;
}
