import {
  filterJobApplicants,
  isUnreviewedJobApplication,
  sortJobApplicants,
  summarizeJobApplicants,
} from "./pipeline";
import type { JobApplicationStatus } from "./types";

function app(
  name: string | null,
  createdAt: string,
  status: JobApplicationStatus = "new",
  username?: string,
) {
  return {
    status,
    createdAt,
    applicant: name || username ? { id: name || "x", name, username } : null,
  };
}

describe("job applicant triage", () => {
  it("treats only applicant-initiated statuses as needing review", () => {
    expect(isUnreviewedJobApplication("interested")).toBe(true);
    expect(isUnreviewedJobApplication("new")).toBe(true);
    expect(isUnreviewedJobApplication("reviewing")).toBe(false);
    expect(isUnreviewedJobApplication("rejected")).toBe(false);
  });

  it("summarizes totals and the untriaged subset", () => {
    const summary = summarizeJobApplicants([
      { status: "new" },
      { status: "interested" },
      { status: "interview" },
      { status: "rejected" },
    ]);
    expect(summary).toEqual({ total: 4, needsReview: 2 });
  });
});

describe("job applicant search", () => {
  const apps = [
    app("Ada Lovelace", "2026-01-03T00:00:00Z"),
    app(null, "2026-01-02T00:00:00Z", "new", "grace_h"),
    app("Bíma Okoro", "2026-01-01T00:00:00Z"),
  ];

  it("matches on name or username", () => {
    expect(filterJobApplicants(apps, "ada")).toHaveLength(1);
    expect(filterJobApplicants(apps, "grace")).toHaveLength(1);
    expect(filterJobApplicants(apps, "zzz")).toHaveLength(0);
  });

  it("ignores accents and surrounding whitespace", () => {
    expect(filterJobApplicants(apps, "  bima ")).toHaveLength(1);
  });

  it("keeps every applicant for an empty query", () => {
    expect(filterJobApplicants(apps, "   ")).toHaveLength(3);
  });
});

describe("job applicant sorting", () => {
  const apps = [
    app("Zoe", "2026-01-01T00:00:00Z"),
    app("Ada", "2026-01-03T00:00:00Z"),
    app(null, "2026-01-02T00:00:00Z"),
  ];

  it("orders by application date in both directions", () => {
    expect(sortJobApplicants(apps, "newest").map((a) => a.createdAt)).toEqual([
      "2026-01-03T00:00:00Z",
      "2026-01-02T00:00:00Z",
      "2026-01-01T00:00:00Z",
    ]);
    expect(sortJobApplicants(apps, "oldest")[0]?.createdAt).toBe(
      "2026-01-01T00:00:00Z",
    );
  });

  it("sorts by name and pushes unnamed candidates last", () => {
    const names = sortJobApplicants(apps, "name").map(
      (a) => a.applicant?.name ?? null,
    );
    expect(names).toEqual(["Ada", "Zoe", null]);
  });

  it("does not mutate the input array", () => {
    const original = [...apps];
    sortJobApplicants(apps, "name");
    expect(apps).toEqual(original);
  });
});
