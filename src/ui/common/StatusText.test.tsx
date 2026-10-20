import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusText } from "./StatusText";

afterEach(cleanup);

const css = readFileSync(resolve(process.cwd(), "src/ui/global.css"), "utf8");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("StatusText", () => {
  it("renders a status indicator inside the class that lets its words wrap normally", () => {
    const { container } = render(<StatusText type="error">Add a permission to generate a policy.</StatusText>);
    const wrapper = container.firstElementChild;
    expect(wrapper).toHaveClass("rc-status-text");
    expect(wrapper?.querySelector("[class*=awsui_status-error]")).not.toBeNull();
    expect(screen.getByText("Add a permission to generate a policy.")).toBeInTheDocument();
  });

  it("is overridden in global.css: no mid-word breaks, long ARNs may still break anywhere", () => {
    const rule = /\.rc-status-text \[class\*="awsui_display-inline-block_"\]\s*\{([^}]*)\}/.exec(css);
    expect(rule, "the .rc-status-text override rule").not.toBeNull();
    expect(rule![1]).toMatch(/word-break: normal !important/);
    expect(rule![1]).toMatch(/overflow-wrap: anywhere !important/);
  });

  it("is the only place the UI renders a Cloudscape StatusIndicator", () => {
    const direct = sources(resolve(process.cwd(), "src/ui"))
      .filter((f) => !f.endsWith("StatusText.tsx"))
      .filter((f) => readFileSync(f, "utf8").includes("@cloudscape-design/components/status-indicator"));
    expect(direct).toEqual([]);
  });
});
