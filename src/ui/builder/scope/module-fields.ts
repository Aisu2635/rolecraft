export interface FieldSpec {
  key: string;
  label: string;
  kind: "text" | "checkbox";
  optional?: boolean;
  placeholder?: string;
  description?: string;
}

const kmsKeyArn: FieldSpec = {
  key: "kmsKeyArn",
  label: "KMS key ARN (optional)",
  kind: "text",
  optional: true,
  placeholder: "arn:aws:kms:us-east-1:123456789012:key/...",
  description: "Add this when the data is encrypted with a customer managed key.",
};

/** The simple modules, whose scope is one required name plus a few switches. Checkboxes default to on. */
export const MODULE_FIELDS: Record<
  "ecr" | "eks" | "lambda" | "dynamodb" | "logs" | "secretsmanager" | "kms" | "sqs",
  FieldSpec[]
> = {
  ecr: [{ key: "repository", label: "Repository name", kind: "text", placeholder: "my-app" }],
  eks: [{ key: "cluster", label: "Cluster name", kind: "text", placeholder: "prod-cluster" }],
  lambda: [{ key: "functionName", label: "Function name", kind: "text", placeholder: "my-function" }],
  dynamodb: [
    { key: "table", label: "Table name", kind: "text", placeholder: "orders" },
    {
      key: "includeIndexes",
      label: "Include the table indexes",
      kind: "checkbox",
      description: "Also allow the same actions on the table's indexes.",
    },
  ],
  logs: [
    { key: "logGroup", label: "Log group name", kind: "text", placeholder: "/aws/lambda/my-function" },
    { key: "createGroup", label: "Allow creating the log group", kind: "checkbox" },
  ],
  secretsmanager: [
    { key: "secretName", label: "Secret name", kind: "text", placeholder: "prod/db-password" },
    kmsKeyArn,
  ],
  kms: [
    {
      key: "keyArn",
      label: "Key ARN",
      kind: "text",
      placeholder: "arn:aws:kms:us-east-1:123456789012:key/...",
    },
  ],
  sqs: [{ key: "queueName", label: "Queue name", kind: "text", placeholder: "my-queue" }, kmsKeyArn],
};
