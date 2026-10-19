import { beforeEach, describe, expect, it } from "vitest";
import { TOUR_KEY, hasSeenTour, mountTour, requestTour, useTourStore } from "./tour";

const s = () => useTourStore.getState();

beforeEach(() => {
  localStorage.removeItem(TOUR_KEY);
  useTourStore.setState({ open: false, index: 0 });
});

describe("tour store", () => {
  it("uses the rolecraft.tour.v1 key", () => {
    expect(TOUR_KEY).toBe("rolecraft.tour.v1");
  });
  it("start opens at the first step, next and back move through the steps", () => {
    s().start();
    expect(s()).toMatchObject({ open: true, index: 0 });
    s().back();
    expect(s().index).toBe(0);
    s().next();
    s().next();
    expect(s().index).toBe(2);
    s().back();
    expect(s().index).toBe(1);
  });
  it("start restarts from step 1 after a partial run", () => {
    s().start();
    s().next();
    s().start();
    expect(s().index).toBe(0);
  });
  it("close hides the tour and persists the seen flag", () => {
    s().start();
    expect(hasSeenTour(localStorage)).toBe(false);
    s().close();
    expect(s().open).toBe(false);
    expect(localStorage.getItem(TOUR_KEY)).toBe("seen");
    expect(hasSeenTour(localStorage)).toBe(true);
  });
  it("next on the last step closes and persists", () => {
    s().start();
    for (let i = 0; i < 4; i++) s().next();
    expect(s()).toMatchObject({ open: true, index: 4 });
    s().next();
    expect(s().open).toBe(false);
    expect(localStorage.getItem(TOUR_KEY)).toBe("seen");
  });
  it("hasSeenTour treats unavailable storage as seen, so the tour never nags", () => {
    expect(hasSeenTour(undefined)).toBe(true);
    expect(
      hasSeenTour({
        getItem: () => {
          throw new Error("denied");
        },
      }),
    ).toBe(true);
  });
  it("requestTour starts only while a tour is mounted", () => {
    requestTour();
    expect(s().open).toBe(false);
    const unmount = mountTour();
    requestTour();
    expect(s().open).toBe(true);
    s().close();
    unmount();
    requestTour();
    expect(s().open).toBe(false);
  });
});
