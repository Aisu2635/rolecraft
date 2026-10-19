import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyModel, type Grant } from "../core/model/model";
import { isRevealed, useBuilderStore } from "./builder";

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

  it("revealErrors: off by default, on after revealAllErrors, off after reset or replaceModel", () => {
    const s = useBuilderStore.getState();
    expect(s.revealErrors).toBe(false);
    s.revealAllErrors();
    expect(useBuilderStore.getState().revealErrors).toBe(true);
    s.reset();
    expect(useBuilderStore.getState().revealErrors).toBe(false);
    s.revealAllErrors();
    s.replaceModel(createEmptyModel());
    expect(useBuilderStore.getState().revealErrors).toBe(false);
  });

  it("adding a grant turns revealErrors off, so a new blank grant is not red before the user touches it", () => {
    const s = useBuilderStore.getState();
    s.revealAllErrors();
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
    expect(isRevealed(st(), "field:trust.owner")).toBe(true);
    expect(isRevealed(st(), "grant:a")).toBe(false);
    st().revealAllErrors();
    expect(isRevealed(st(), "grant:a")).toBe(true);
    expect(isRevealed({ revealErrors: false, touched: { x: true } }, "x")).toBe(true);
  });

  it("touching an already touched id keeps the same state", () => {
    st().touch("x");
    const before = st();
    st().touch("x");
    expect(st()).toBe(before);
  });

  it("reset clears touched; replaceModel replaces it with the loaded fields that hold a value", () => {
    st().touch("x");
    st().reset();
    expect(st().touched).toEqual({});
    st().touch("x");
    st().replaceModel({ ...createEmptyModel(), name: "" });
    expect(st().touched).toEqual({ "field:policyMode": true, "field:trust.service": true });
  });

  it("loading a role touches exactly the fields with a value: a sender's mistake shows, a blank stays a to-do", () => {
    const s3 = (id: string, bucket: string): Grant => ({
      id,
      service: "s3",
      module: "s3",
      scope: { type: "module", data: { bucket, prefixes: [""], allowNavigation: false } },
      access: { type: "preset", preset: "list-read" },
    });
    st().replaceModel({
      ...createEmptyModel(),
      accountId: "123",
      trust: { kind: "github", owner: "octo", repo: "", ref: { type: "branch", value: "main" } },
      managedPolicyArns: ["nope", ""],
      grants: [s3("bad", "Bad_Bucket"), s3("blank", ""), { ...g, id: "arns", scope: { type: "arns", arns: [] } }],
    });
    expect(st().revealErrors).toBe(false);
    expect(Object.keys(st().touched).sort()).toEqual([
      "field:accountId",
      "field:managedPolicyArns",
      "field:managedPolicyArns[0]",
      "field:name",
      "field:policyMode",
      "field:trust.owner",
      "field:trust.ref.type",
      "field:trust.ref.value",
      "grant:bad",
    ]);
  });

  it("removing a grant forgets it", () => {
    st().addGrant(g);
    st().touch("grant:a");
    st().touch("field:name");
    st().removeGrant("a");
    expect(st().touched).toEqual({ "field:name": true });
  });

  it("removing a managed policy ARN row forgets that row and the rows after it, so a new row is not born red", () => {
    st().setFields({ managedPolicyArns: ["a", "b", "c"] });
    for (const i of [0, 1, 2]) st().touch(`field:managedPolicyArns[${i}]`);
    st().touch("field:managedPolicyArns");
    st().setFields({ managedPolicyArns: ["a", "c"] });
    expect(st().touched).toEqual({ "field:managedPolicyArns[0]": true, "field:managedPolicyArns": true });
    st().setFields({ managedPolicyArns: ["a", "c", ""] });
    expect(isRevealed(st(), "field:managedPolicyArns[2]")).toBe(false);
    const before = st().touched;
    st().setFields({ name: "n" });
    expect(st().touched).toBe(before);
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
