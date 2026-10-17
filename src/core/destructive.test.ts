import { describe, expect, it } from "vitest";
import { isDeletion } from "./destructive";

describe("isDeletion", () => {
  it("matches delete, purge and terminate actions", () => {
    for (const a of ["DeleteObject", "ec2:DeleteVpc", "PurgeQueue", "sqs:PurgeQueue", "ScheduleKeyDeletion", "TerminateInstances", "ec2:TerminateInstances"]) {
      expect(isDeletion(a)).toBe(true);
    }
  });
  it("does not match other actions", () => {
    for (const a of ["GetObject", "ec2:DescribeInstances", "ec2:StopInstances", "ListTerminatedThings"]) {
      expect(isDeletion(a)).toBe(false);
    }
  });
});
