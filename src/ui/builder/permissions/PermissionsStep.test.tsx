import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useBuilderStore } from "../../../state/builder";
import { PermissionsStep } from "./PermissionsStep";
import { grantFor, readyCatalog, withCatalog } from "./test-catalog";

beforeEach(() => useBuilderStore.getState().reset());
afterEach(cleanup);

describe("PermissionsStep", () => {
  it("offers the Sentences editor and the Grid", async () => {
    const cat = await readyCatalog("s3");
    render(withCatalog(cat, <PermissionsStep />));
    const [sentences, grid] = createWrapper(document.body).findSegmentedControl()!.findSegments();
    expect(sentences!.getElement()).toHaveTextContent("Sentences");
    expect(sentences!.getElement()).toHaveAttribute("aria-pressed", "true");
    expect(grid!.getElement()).toHaveTextContent("Grid");
    expect(grid!.getElement()).not.toBeDisabled();
  });

  it("guides the user to add a first permission", async () => {
    const cat = await readyCatalog("s3");
    render(withCatalog(cat, <PermissionsStep />));
    expect(screen.getByText("No permissions yet. Pick a service on the left to add one.")).toBeInTheDocument();
  });

  it("lists a row per grant", async () => {
    const cat = await readyCatalog("s3", "ec2");
    useBuilderStore.getState().addGrant(grantFor(cat, "s3", "a"));
    useBuilderStore.getState().addGrant(grantFor(cat, "ec2", "b"));
    render(withCatalog(cat, <PermissionsStep />));
    expect(screen.getAllByRole("group", { name: /permission$/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove Amazon EC2 permission" }));
    expect(screen.getAllByRole("group", { name: /permission$/ })).toHaveLength(1);
  });

  it("explains in plain English what the role can do, below the editor", async () => {
    const cat = await readyCatalog("s3");
    useBuilderStore.getState().addGrant({
      ...grantFor(cat, "s3", "a"),
      scope: { type: "module", data: { bucket: "my-bucket", prefixes: [""], allowNavigation: false } },
    });
    render(withCatalog(cat, <PermissionsStep />));
    expect(screen.getByRole("heading", { name: "Can" })).toBeInTheDocument();
  });
});
