import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyModel, type Grant } from "../core/model/model";
import { useBuilderStore } from "./builder";

const g: Grant = { id: "a", service: "s3", scope: { type: "all" }, access: { type: "levels", levels: ["Read"] } };

describe("builder store", () => {
  beforeEach(() => useBuilderStore.getState().reset());

  it("setEditor keeps the model reference", () => {
    const before = useBuilderStore.getState().model;
    useBuilderStore.getState().setEditor("grid");
    const s = useBuilderStore.getState();
    expect(s.editor).toBe("grid");
    expect(s.model).toBe(before);
  });

  it("model actions go through model-ops", () => {
    const s = useBuilderStore.getState();
    s.setFields({ name: "n" });
    s.setTrust({ kind: "account", accountId: "" });
    s.addGrant(g);
    s.updateGrant("a", (x) => ({ ...x, service: "ec2" }));
    expect(useBuilderStore.getState().model.name).toBe("n");
    expect(useBuilderStore.getState().model.trust.kind).toBe("account");
    expect(useBuilderStore.getState().model.grants[0]?.service).toBe("ec2");
    useBuilderStore.getState().removeGrant("a");
    expect(useBuilderStore.getState().model.grants).toEqual([]);
  });

  it("replaceModel and ui setters", () => {
    const m = { ...createEmptyModel(), name: "other" };
    const s = useBuilderStore.getState();
    s.replaceModel(m);
    s.setStep(2);
    s.focus("grant:a");
    s.setShareStatus("too-large");
    const st = useBuilderStore.getState();
    expect(st.model).toBe(m);
    expect([st.step, st.focusTarget, st.shareStatus]).toEqual([2, "grant:a", "too-large"]);
  });

  it("reset returns an empty model at step 0", () => {
    const s = useBuilderStore.getState();
    s.setFields({ name: "zzz" });
    s.setStep(2);
    s.setEditor("grid");
    s.focus("x");
    s.reset();
    const st = useBuilderStore.getState();
    expect(st.model).toEqual(createEmptyModel());
    expect(st.step).toBe(0);
    expect(st.editor).toBe("sentences");
    expect(st.focusTarget).toBeNull();
    expect(st.shareStatus).toBe("ok");
  });
});
