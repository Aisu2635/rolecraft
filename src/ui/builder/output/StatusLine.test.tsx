import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Issue } from "../../../core/types";
import { StatusLine } from "./StatusLine";

afterEach(cleanup);

const issue = (severity: Issue["severity"]): Issue => ({ id: "X", severity, message: "m" });

describe("StatusLine", () => {
  it("announces the counts politely through a visually hidden summary", () => {
    const { rerender } = render(<StatusLine issues={[issue("error"), issue("info"), issue("info")]} onActivate={vi.fn()} />);
    const live = screen.getByText("1 error, 0 warnings, 2 info");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveClass("rc-visually-hidden");
    rerender(<StatusLine issues={[issue("warning")]} onActivate={vi.fn()} />);
    expect(live).toHaveTextContent("0 errors, 1 warning, 0 info");
  });
});

describe("StatusLine to-dos", () => {
  it("counts to-dos first when there are any, and never marks zero errors in red", () => {
    const { container, rerender } = render(<StatusLine issues={[issue("info")]} pending={1} onActivate={vi.fn()} />);
    expect(screen.getByText("1 to do, 0 errors, 0 warnings, 1 info")).toBeInTheDocument();
    expect(container.querySelector("[class*=awsui_status-pending]")).toHaveTextContent("1 to do");
    expect(container.querySelector("[class*=awsui_status-error]")).toBeNull();
    rerender(<StatusLine issues={[issue("error")]} onActivate={vi.fn()} />);
    expect(screen.getByText("1 error, 0 warnings, 0 info")).toBeInTheDocument();
    expect(container.querySelector("[class*=awsui_status-error]")).toHaveTextContent("1 error");
    expect(container.querySelector("[class*=awsui_status-pending]")).toBeNull();
  });
});
