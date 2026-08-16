import { normalizeMarketplaceReportReason } from "./marketplaceReportReason";

/**
 * The reports table CHECK constraint accepts only scam/spam/inappropriate/
 * other. Mobile sends wrong_category / prohibited_item, which used to fail the
 * insert outright; web used to send three visually distinct options that all
 * carried value="other", losing the distinction. Both now normalize here.
 */
describe("normalizeMarketplaceReportReason", () => {
  it("passes canonical reasons through untouched", () => {
    expect(normalizeMarketplaceReportReason("scam", "fake receipts")).toEqual({
      reason: "scam",
      details: "fake receipts",
    });
    expect(normalizeMarketplaceReportReason("other", undefined)).toEqual({
      reason: "other",
      details: undefined,
    });
  });

  it("folds richer reasons into 'other' and keeps the label in details", () => {
    expect(
      normalizeMarketplaceReportReason("wrong_category", "this is a textbook"),
    ).toEqual({
      reason: "other",
      details: "[wrong category] this is a textbook",
    });
    expect(normalizeMarketplaceReportReason("prohibited_item", "")).toEqual({
      reason: "other",
      details: "[prohibited item]",
    });
  });

  it("defaults a missing reason to 'other'", () => {
    expect(normalizeMarketplaceReportReason(undefined, "details")).toEqual({
      reason: "other",
      details: "details",
    });
  });
});
