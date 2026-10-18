import { act, cleanup, render, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyModel, type RoleModel } from "../core/model/model";
import { encodeModel, MAX_SHARE_LENGTH } from "../core/model/share";
import { useBuilderStore } from "./builder";
import { initialModel, syncHash, useShareSync } from "./share-sync";

const store = () => useBuilderStore.getState();

function withGrant(name: string): RoleModel {
  return {
    ...createEmptyModel(),
    name,
    grants: [{ id: "g_aaaaaaaa", service: "s3", scope: { type: "all" }, access: { type: "levels", levels: ["Read"] } }],
  };
}

/**
 * A model padded with incompressible policy ARNs. `extra` characters on the first ARN were tuned so the encoding is
 * exactly 8,192 characters at 4,790 and 8,194 at 4,793. lz-string only produces even lengths for this shape, so
 * 8,193 cannot be hit and 8,194 is the smallest reachable length over the limit.
 */
function padded(extra: number): RoleModel {
  let a = 7;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rnd = (n: number): string =>
    Array.from({ length: n }, () => "0123456789abcdefghijklmnopqrstuvwxyz"[Math.floor(next() * 36)]).join("");
  const m = createEmptyModel();
  m.managedPolicyArns = Array.from({ length: 100 }, () => rnd(24));
  m.managedPolicyArns[0] += rnd(extra);
  return m;
}
const atLimit = (): RoleModel => padded(4790);
const justOver = (): RoleModel => padded(4793);

function fakeEnv(hash = "") {
  const loc = { pathname: "/builder", search: "", hash };
  const hist = { state: null as unknown, replaceState: vi.fn() };
  return { loc, hist };
}

beforeEach(() => store().reset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("initialModel", () => {
  it("restores a model from the hash", () => {
    const m = withGrant("r1");
    expect(initialModel("#s=" + encodeModel(m))).toEqual({ model: m, invalid: false });
  });
  it("returns the empty model without a share hash", () => {
    expect(initialModel("")).toEqual({ model: createEmptyModel(), invalid: false });
    expect(initialModel("#other")).toEqual({ model: createEmptyModel(), invalid: false });
  });
  it("flags garbage as invalid and starts empty", () => {
    expect(initialModel("#s=garbage")).toEqual({ model: createEmptyModel(), invalid: true });
  });
});

describe("syncHash", () => {
  it("writes the hash at exactly the limit", () => {
    const { loc, hist } = fakeEnv();
    const m = atLimit();
    expect(encodeModel(m).length).toBe(MAX_SHARE_LENGTH);
    expect(syncHash(m, loc, hist)).toBe("ok");
    expect(hist.replaceState).toHaveBeenCalledWith(null, "", "/builder#s=" + encodeModel(m));
  });
  it("refuses a model just over the limit and clears the hash", () => {
    const { loc, hist } = fakeEnv("#s=old");
    loc.search = "?x=1";
    const m = justOver();
    expect(encodeModel(m).length).toBe(MAX_SHARE_LENGTH + 2);
    expect(syncHash(m, loc, hist)).toBe("too-large");
    expect(hist.replaceState).toHaveBeenCalledWith(null, "", "/builder?x=1");
  });
});

describe("useShareSync", () => {
  it("loads a valid hash on mount, opening Permissions when it has grants", () => {
    const m = withGrant("restored");
    window.history.replaceState(null, "", "/#s=" + encodeModel(m));
    const { result } = renderHook(() => useShareSync());
    expect(store().model).toEqual(m);
    expect(store().step).toBe(1);
    expect(store().revealErrors).toBe(true);
    expect(result.current.invalidLink).toBe(false);
  });
  it("stays on the first step for a restored role without grants", () => {
    window.history.replaceState(null, "", "/#s=" + encodeModel({ ...createEmptyModel(), name: "x" }));
    renderHook(() => useShareSync());
    expect(store().model.name).toBe("x");
    expect(store().step).toBe(0);
  });
  it("flags an invalid link, starts empty, and can be dismissed", () => {
    window.history.replaceState(null, "", "/#s=garbage");
    const { result } = renderHook(() => useShareSync());
    expect(result.current.invalidLink).toBe(true);
    expect(store().model).toEqual(createEmptyModel());
    act(() => result.current.dismiss());
    expect(result.current.invalidLink).toBe(false);
  });
  it("keeps the in-memory role when there is no hash, and writes it to the URL", () => {
    vi.useFakeTimers();
    store().setFields({ name: "kept" });
    renderHook(() => useShareSync());
    expect(store().model.name).toBe("kept");
    act(() => void vi.advanceTimersByTime(300));
    expect(window.location.hash).toBe("#s=" + encodeModel(store().model));
  });
  it("does not write a hash for an untouched empty role", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(window.history, "replaceState");
    renderHook(() => useShareSync());
    act(() => void vi.advanceTimersByTime(1000));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("debounces three edits within 300 ms into one replaceState call", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(window.history, "replaceState");
    renderHook(() => useShareSync());
    act(() => {
      store().setFields({ name: "a" });
      vi.advanceTimersByTime(100);
      store().setFields({ name: "ab" });
      vi.advanceTimersByTime(100);
      store().setFields({ name: "abc" });
    });
    expect(spy).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(300));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#s=" + encodeModel(store().model));
    expect(store().shareStatus).toBe("ok");
    spy.mockRestore();
  });
  it("records too-large and clears the hash", () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/#s=old");
    renderHook(() => useShareSync());
    act(() => {
      store().replaceModel(justOver());
      vi.advanceTimersByTime(300);
    });
    expect(store().shareStatus).toBe("too-large");
    expect(window.location.hash).toBe("");
  });
  it("loads another valid link on hashchange, but ignores the hash it wrote itself", () => {
    vi.useFakeTimers();
    renderHook(() => useShareSync());
    act(() => {
      store().setFields({ name: "mine" });
      vi.advanceTimersByTime(300);
    });
    const ownHash = window.location.hash;
    act(() => store().setFields({ name: "mine2" }));
    // A hashchange that merely echoes our own write must not touch the model.
    act(() => {
      window.history.replaceState(null, "", "/" + ownHash);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(store().model.name).toBe("mine2");
    const other = withGrant("other");
    act(() => {
      window.history.replaceState(null, "", "/#s=" + encodeModel(other));
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(store().model).toEqual(other);
    expect(store().step).toBe(1);
  });
  it("shows the invalid-link notice for a bad hashchange", () => {
    const { result } = renderHook(() => useShareSync());
    act(() => {
      window.history.replaceState(null, "", "/#s=nope");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current.invalidLink).toBe(true);
    expect(store().model).toEqual(createEmptyModel());
  });
  it("ignores a hashchange that removes the share hash", () => {
    store().setFields({ name: "stay" });
    renderHook(() => useShareSync());
    act(() => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(store().model.name).toBe("stay");
  });
  it("flushes a pending write on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useShareSync());
    act(() => store().setFields({ name: "late" }));
    unmount();
    expect(window.location.hash).toBe("#s=" + encodeModel(store().model));
  });
  it("does not write a hash onto another route when unmounted after navigating away", () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/builder");
    const { unmount } = renderHook(() => useShareSync());
    act(() => store().setFields({ name: "late" }));
    window.history.replaceState(null, "", "/templates");
    unmount();
    act(() => void vi.advanceTimersByTime(1000));
    expect(window.location.pathname).toBe("/templates");
    expect(window.location.hash).toBe("");
  });
  it("stops syncing after unmount", () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useShareSync());
    unmount();
    act(() => store().setFields({ name: "after" }));
    act(() => void vi.advanceTimersByTime(1000));
    expect(window.location.hash).toBe("");
  });
  it("survives StrictMode double-mounting without clobbering the restored role", () => {
    vi.useFakeTimers();
    const m = withGrant("strict");
    window.history.replaceState(null, "", "/#s=" + encodeModel(m));
    function Probe() {
      useShareSync();
      return null;
    }
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    act(() => void vi.advanceTimersByTime(1000));
    expect(store().model).toEqual(m);
    expect(window.location.hash).toBe("#s=" + encodeModel(m));
  });
});
