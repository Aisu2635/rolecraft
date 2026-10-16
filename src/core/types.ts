export type AccessLevel =
  "List" | "Read" | "Write" | "Tagging" | "Permissions management";

export const ACCESS_LEVELS: readonly AccessLevel[] = [
  "List",
  "Read",
  "Write",
  "Tagging",
  "Permissions management",
];

export type Category =
  | "Compute"
  | "Storage"
  | "Database"
  | "Networking"
  | "Containers"
  | "Serverless"
  | "AI/ML"
  | "Analytics"
  | "Security & Identity"
  | "Management"
  | "Developer Tools"
  | "Messaging"
  | "Other";

export interface SlimAction {
  name: string;
  level: AccessLevel;
  resources: string[];
  label: string;
  conditionKeys: string[];
}
export interface SlimResource {
  name: string;
  arnFormats: string[];
  conditionKeys: string[];
}
export interface SlimService {
  key: string;
  name: string;
  category: Category;
  actions: SlimAction[];
  resources: SlimResource[];
  conditionKeys: string[];
}
export interface ServiceIndexEntry {
  key: string;
  name: string;
  category: Category;
  actionCount: number;
}
export interface ServiceIndex {
  generatedAt: string;
  services: ServiceIndexEntry[];
}

export type Severity = "error" | "warning" | "info";
export interface Issue {
  id: string;
  severity: Severity;
  message: string;
  grantId?: string;
  path?: string;
}

export type ConditionBlock = Record<string, Record<string, string | string[]>>;
export interface Statement {
  Sid?: string;
  Effect: "Allow" | "Deny";
  Principal?: Record<string, string | string[]> | "*";
  Action: string | string[];
  Resource?: string | string[];
  Condition?: ConditionBlock;
}
export interface PolicyDocument {
  Version: "2012-10-17";
  Statement: Statement[];
}
