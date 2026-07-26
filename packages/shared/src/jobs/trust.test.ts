import {
  formatJobCompanyVerificationLabel,
  getJobEmployerTrustPresentation,
  isJobCompanyVerified,
  isJobReportReason,
} from "./trust";

describe("job trust helpers", () => {
  it("classifies verified, unverified company, and individual posters", () => {
    expect(
      getJobEmployerTrustPresentation({
        companyId: "c1",
        company: { verificationStatus: "verified" },
      }).kind,
    ).toBe("verified_company");
    expect(
      getJobEmployerTrustPresentation({
        companyId: "c1",
        company: { verificationStatus: "pending" },
      }).kind,
    ).toBe("unverified_company");
    expect(getJobEmployerTrustPresentation({}).kind).toBe("individual");
    expect(
      isJobCompanyVerified({ verificationStatus: "verified" }),
    ).toBe(true);
    expect(
      isJobCompanyVerified({ verificationStatus: "pending" }),
    ).toBe(false);
  });

  it("validates report reasons and formats verification labels", () => {
    expect(isJobReportReason("scam")).toBe(true);
    expect(isJobReportReason("not-a-reason")).toBe(false);
    expect(formatJobCompanyVerificationLabel("pending")).toBe(
      "Pending review",
    );
    expect(formatJobCompanyVerificationLabel("rejected")).toBe(
      "Verification rejected",
    );
  });
});
