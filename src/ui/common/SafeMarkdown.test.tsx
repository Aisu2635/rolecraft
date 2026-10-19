import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SafeMarkdown } from "./SafeMarkdown";

afterEach(cleanup);

describe("SafeMarkdown", () => {
  it("renders code and bold, and never interprets HTML", () => {
    const { container } = render(<SafeMarkdown markdown={"`a` **b** <img src=x onerror=alert(1)>"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("code")?.textContent).toBe("a");
    expect(container.querySelector("strong")?.textContent).toBe("b");
    expect(container.querySelector("p")?.textContent).toBe("a b <img src=x onerror=alert(1)>");
  });

  it("unescapes backslashes, keeps escapes inside code, and nests code in bold", () => {
    const { container } = render(<SafeMarkdown markdown={"my\\_role \\*x\\* **a `b\\_c`**"} />);
    expect(container.querySelector("p")?.textContent).toBe("my_role *x* a b\\_c");
    expect(container.querySelector("strong code")?.textContent).toBe("b\\_c");
  });

  it("renders fences through CodeView, paragraphs, headings, and an unclosed fence", () => {
    const md = ["### Title", "", "one", "two", "", "```powershell", "pwsh -File .\\a.ps1", "```", "", "```", "last"].join("\n");
    const { container } = render(<SafeMarkdown markdown={md} />);
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("p")?.textContent).toBe("one two");
    const pres = container.querySelectorAll("pre");
    expect(pres).toHaveLength(2);
    expect(pres[0]?.textContent).toBe("pwsh -File .\\a.ps1");
    expect(pres[0]?.getAttribute("data-language")).toBe("powershell");
    expect(pres[1]?.textContent).toBe("last");
  });
});
