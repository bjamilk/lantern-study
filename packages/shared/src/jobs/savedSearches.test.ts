import {
  describeJobSearchFilters,
  isEmptyJobSearchFilters,
  jobPostingMatchesSearch,
  normalizeJobSearchFilters,
  suggestJobSavedSearchName,
} from "./savedSearches";

describe("normalizeJobSearchFilters", () => {
  it("keeps valid values and drops unknown keys", () => {
    expect(
      normalizeJobSearchFilters({
        search: "  tutor  ",
        employmentType: "part_time",
        compensationKind: "paid",
        companyOnly: true,
        remote: false,
        sort: "trending",
        somethingElse: "drop me",
      }),
    ).toEqual({
      search: "tutor",
      employmentType: "part_time",
      compensationKind: "paid",
      companyOnly: true,
      remote: false,
      sort: "trending",
    });
  });

  it("drops invalid values rather than failing", () => {
    expect(
      normalizeJobSearchFilters({
        employmentType: "astronaut",
        compensationKind: "equity",
        remote: "yes",
        companyOnly: "true",
        sort: "salary",
        search: "   ",
      }),
    ).toEqual({});
  });

  it("treats non-objects as no filters", () => {
    expect(normalizeJobSearchFilters(null)).toEqual({});
    expect(normalizeJobSearchFilters("remote")).toEqual({});
  });

  it("caps a long search term", () => {
    const filters = normalizeJobSearchFilters({ search: "a".repeat(500) });
    expect(filters.search).toHaveLength(120);
  });
});

describe("filter descriptions", () => {
  it("summarises a filter set for display", () => {
    expect(
      describeJobSearchFilters({
        search: "tutor",
        employmentType: "part_time",
        remote: true,
        compensationKind: "paid",
      }),
    ).toBe('"tutor" · Part-time · Remote · Paid');
  });

  it("falls back to a label for an empty set", () => {
    expect(describeJobSearchFilters({})).toBe("All jobs");
    expect(suggestJobSavedSearchName({})).toBe("All jobs");
    expect(isEmptyJobSearchFilters({})).toBe(true);
    // Sort alone is not a narrowing filter.
    expect(isEmptyJobSearchFilters({ sort: "closing" })).toBe(true);
    expect(isEmptyJobSearchFilters({ remote: false })).toBe(false);
  });
});

describe("jobPostingMatchesSearch", () => {
  const posting = {
    title: "Weekend maths tutor",
    description: "Teach secondary school maths on Saturdays.",
    employmentType: "part_time" as const,
    isRemote: false,
    campusId: "campus-1",
    companyId: null,
    compensation: { kind: "paid" as const, currency: "NGN", amountMin: 50000 },
  };

  it("matches an empty filter set", () => {
    expect(jobPostingMatchesSearch(posting, {})).toBe(true);
  });

  it("matches on search terms in the title or description", () => {
    expect(jobPostingMatchesSearch(posting, { search: "tutor" })).toBe(true);
    expect(jobPostingMatchesSearch(posting, { search: "saturdays" })).toBe(
      true,
    );
    expect(jobPostingMatchesSearch(posting, { search: "driver" })).toBe(false);
  });

  it("respects employment type, campus, and compensation", () => {
    expect(
      jobPostingMatchesSearch(posting, { employmentType: "part_time" }),
    ).toBe(true);
    expect(
      jobPostingMatchesSearch(posting, { employmentType: "full_time" }),
    ).toBe(false);
    expect(jobPostingMatchesSearch(posting, { campusId: "campus-1" })).toBe(
      true,
    );
    expect(jobPostingMatchesSearch(posting, { campusId: "campus-2" })).toBe(
      false,
    );
    expect(jobPostingMatchesSearch(posting, { compensationKind: "paid" })).toBe(
      true,
    );
    expect(
      jobPostingMatchesSearch(posting, { compensationKind: "unpaid" }),
    ).toBe(false);
  });

  it("distinguishes remote from on-site", () => {
    expect(jobPostingMatchesSearch(posting, { remote: false })).toBe(true);
    expect(jobPostingMatchesSearch(posting, { remote: true })).toBe(false);
    expect(
      jobPostingMatchesSearch({ ...posting, isRemote: true }, { remote: true }),
    ).toBe(true);
  });

  it("excludes individual posters when companies only is set", () => {
    expect(jobPostingMatchesSearch(posting, { companyOnly: true })).toBe(false);
    expect(
      jobPostingMatchesSearch(
        { ...posting, companyId: "company-1" },
        { companyOnly: true },
      ),
    ).toBe(true);
  });

  it("requires every filter to pass", () => {
    expect(
      jobPostingMatchesSearch(posting, {
        search: "tutor",
        employmentType: "full_time",
      }),
    ).toBe(false);
  });
});
