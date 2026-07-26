import {
  averageNumber,
  buildJobHiringFunnel,
  countJobApplicationStatuses,
  daysBetween,
  describeJobConversion,
  emptyJobApplicationStatusCounts,
  isHighViewsLowApply,
  isStaleActivePosting,
  jobConversionRates,
  jobFunnelStageEntries,
  jobPercent,
  medianNumber,
} from "./analytics";

describe("job hiring analytics", () => {
  it("counts statuses and builds a point-in-time funnel", () => {
    const statusCounts = countJobApplicationStatuses([
      "new",
      "interested",
      "chatting",
      "reviewing",
      "interview",
      "offer",
      "hired",
      "rejected",
      "withdrawn",
    ]);
    const funnel = buildJobHiringFunnel({
      views: 100,
      saved: 8,
      externalClicks: 3,
      statusCounts,
    });
    expect(funnel).toEqual({
      views: 100,
      saved: 8,
      externalClicks: 3,
      applied: 9,
      needsReview: 2,
      reviewing: 2,
      interview: 1,
      offer: 1,
      hired: 1,
      rejected: 1,
      withdrawn: 1,
    });
  });

  it("computes conversion rates and leaves empty denominators null", () => {
    const empty = jobConversionRates(
      buildJobHiringFunnel({ statusCounts: emptyJobApplicationStatusCounts() }),
    );
    expect(empty.viewToApplyPercent).toBeNull();
    expect(empty.applyToInterviewPercent).toBeNull();

    const rates = jobConversionRates(
      buildJobHiringFunnel({
        views: 50,
        statusCounts: countJobApplicationStatuses([
          "new",
          "new",
          "interview",
          "offer",
          "hired",
        ]),
      }),
    );
    expect(rates.viewToApplyPercent).toBe(10); // 5/50
    expect(rates.applyToInterviewPercent).toBe(60); // 3/5
    expect(rates.interviewToOfferPercent).toBe(67); // 2/3
    expect(rates.offerToHirePercent).toBe(50); // 1/2
  });

  it("rounds jobPercent and formats display", () => {
    expect(jobPercent(1, 3)).toBe(33);
    expect(jobPercent(0, 0)).toBeNull();
    expect(describeJobConversion(33)).toBe("33%");
    expect(describeJobConversion(null)).toBe("—");
  });

  it("computes day spans and central tendency", () => {
    expect(
      daysBetween("2026-01-01T00:00:00.000Z", "2026-01-11T00:00:00.000Z"),
    ).toBe(10);
    expect(
      daysBetween("2026-01-11T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
    ).toBeNull();
    expect(medianNumber([1, 5, 9])).toBe(5);
    expect(medianNumber([1, 2, 3, 100])).toBe(3);
    expect(averageNumber([2, 4, 6])).toBe(4);
    expect(averageNumber([])).toBeNull();
  });

  it("flags attention candidates", () => {
    expect(
      isHighViewsLowApply({ status: "active", views: 40, applications: 1 }),
    ).toBe(true);
    expect(
      isHighViewsLowApply({ status: "active", views: 40, applications: 5 }),
    ).toBe(false);
    expect(
      isHighViewsLowApply({ status: "paused", views: 100, applications: 0 }),
    ).toBe(false);

    expect(
      isStaleActivePosting({
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        applications: 1,
        now: new Date("2026-01-20T00:00:00.000Z"),
      }),
    ).toBe(true);
    expect(
      isStaleActivePosting({
        status: "active",
        createdAt: "2026-01-10T00:00:00.000Z",
        applications: 1,
        now: new Date("2026-01-20T00:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("exposes funnel stage entries in display order", () => {
    const entries = jobFunnelStageEntries(
      buildJobHiringFunnel({
        views: 10,
        statusCounts: countJobApplicationStatuses(["hired"]),
      }),
    );
    expect(entries.map(([stage]) => stage)).toEqual([
      "views",
      "applied",
      "reviewing",
      "interview",
      "offer",
      "hired",
    ]);
    expect(entries.find(([stage]) => stage === "hired")?.[1]).toBe(1);
  });
});
