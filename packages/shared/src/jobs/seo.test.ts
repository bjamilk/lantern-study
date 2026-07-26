import { buildJobCompanySeo, buildJobPostingSeo, JOBS_BROWSE_SEO } from "./seo";

describe("job SEO builders", () => {
  it("builds job posting title, canonical, and JobPosting JSON-LD", () => {
    const seo = buildJobPostingSeo({
      id: "job-1",
      title: "Campus tutor",
      description: "Help first-years with CHEM101 on campus twice a week.",
      employmentType: "tutoring",
      compensation: { kind: "paid", currency: "NGN", amountMin: 3000, period: "hour" },
      locationText: "UNILAG",
      isRemote: false,
      campusName: "University of Lagos",
      company: null,
      poster: { id: "u1", name: "Ada", username: "ada", avatarUrl: null },
      status: "active",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(seo.title).toContain("Campus tutor");
    expect(seo.title).toContain("Ada");
    expect(seo.canonicalUrl).toBe(
      "https://lanternstudy.com/marketplace/jobs/job-1",
    );
    expect(seo.description.length).toBeLessThanOrEqual(160);
    expect(seo.jsonLd["@type"]).toBe("JobPosting");
  });

  it("builds company SEO from tagline and open role count", () => {
    const seo = buildJobCompanySeo(
      {
        id: "co-1",
        displayName: "Lantern Labs",
        tagline: "Build learning tools for campus.",
        about: null,
        industry: "Edtech",
        hqLocation: "Lagos",
        logoUrl: "https://example.com/logo.png",
        website: "https://example.com",
        verificationStatus: "verified",
      },
      3,
    );

    expect(seo.title).toBe("Lantern Labs — jobs on Lantern Study");
    expect(seo.canonicalUrl).toBe(
      "https://lanternstudy.com/marketplace/companies/co-1",
    );
    expect(seo.description).toContain("Build learning tools");
    expect(seo.ogImage).toBe("https://example.com/logo.png");
    expect(seo.jsonLd["@type"]).toBe("Organization");
  });

  it("exposes browse SEO constants", () => {
    expect(JOBS_BROWSE_SEO.canonicalUrl).toBe(
      "https://lanternstudy.com/marketplace/jobs",
    );
  });
});
