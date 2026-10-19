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

  it("revealErrors: off by default, on after replaceModel or revealAllErrors, off after reset", () => {
    const s = useBuilderStore.getState();
    expect(s.revealErrors).toBe(false);
    s.revealAllErrors();
    expect(useBuilderStore.getState().revealErrors).toBe(true);
    s.reset();
    expect(useBuilderStore.getState().revealErrors).toBe(false);
    s.replaceModel(createEmptyModel());
    expect(useBuilderStore.getState().revealErrors).toBe(true);
    s.reset();
    expect(useBuilderStore.getState().revealErrors).toBe(false);
  });

  it("adding a grant turns revealErrors off, so a new blank grant is not red before the user touches it", () => {
    const s = useBuilderStore.getState();
    s.replaceModel(createEmptyModel());
    expect(useBuilderStore.getState().revealErrors).toBe(true);
    s.addGrant(g);
    expect(useBuilderStore.getState().revealErrors).toBe(false);
    s.revealAllErrors();
    s.addGrant({ ...g, id: "b" });
    expect(useBuilderStore.getState().revealErrors).toBe(false);
  });
});

describe("builder store: touched fields", () => {
  beforeEach(() => useBuilderStore.getState().reset());
  const st = () => useBuilderStore.getState();

  it("touch marks one focus id; isRevealed is true for touched ids or when every error is revealed", () => {
    expect(st().touched).toEqual({});
    st().touch("field:trust.owner");
    expect(st().touched).toEqual({ "field:trust.owner": true });
    expect(st().isRevealed("field:trust.owner")).toBe(true);
    expect(st().isRevealed("grant:a")).toBe(false);
    st().revealAllErrors();
    expect(st().isRevealed("grant:a")).toBe(true);
  });

  it("touching an already touched id keeps the same state", () => {
    st().touch("x");
    const before = st();
    st().touch("x");
    expect(st()).toBe(before);
  });

  it("reset and replaceModel clear touched", () => {
    st().touch("x");
    st().reset();
    expect(st().touched).toEqual({});
    st().touch("x");
    st().replaceModel(createEmptyModel());
    expect(st().touched).toEqual({});
  });

  it("switching the trust kind clears the trust fields it replaces; editing the same kind keeps them", () => {
    st().setTrust({ kind: "account", accountId: "" });
    st().touch("field:trust.accountId");
    st().touch("field:accountId");
    st().touch("grant:a");
    st().setTrust({ kind: "account", accountId: "1" });
    expect(st().touched["field:trust.accountId"]).toBe(true);
    st().setTrust({ kind: "github", owner: "", repo: "", ref: { type: "branch", value: "main" } });
    expect(st().touched).toEqual({ "field:accountId": true, "grant:a": true });
  });
});
