import {
  canApplicantRespondToJobOffer,
  canAutoCloseJobPostingOnHire,
  canEmployerWithdrawJobOffer,
  canSetJobOfferStatus,
  describeJobOffer,
  describeJobOfferDeadline,
  effectiveJobOfferStatus,
  hasOpenJobOffer,
  isJobOfferExpired,
  JOB_OFFER_DEFAULT_EXPIRY_DAYS,
  JOB_OFFER_MAX_EXPIRY_DAYS,
  JOB_OFFER_MIN_EXPIRY_MINUTES,
  normalizeJobOfferExpiry,
  normalizeJobOfferStartDate,
} from "./offers";
import type { JobOffer } from "./offers";

const NOW = new Date("2026-08-01T12:00:00.000Z");

function hours(offset: number): string {
  return new Date(NOW.getTime() + offset * 3600_000).toISOString();
}

function offer(overrides: Partial<JobOffer> = {}): JobOffer {
  return {
    id: "offer-1",
    applicationId: "app-1",
    postingId: "post-1",
    applicantId: "user-1",
    createdBy: "user-2",
    status: "sent",
    compensation: { kind: "paid", currency: "NGN", amountMin: 150000 },
    closePostingOnAccept: true,
    expiresAt: hours(48),
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe("expiry handling", () => {
  it("treats a sent offer past its deadline as expired without a write", () => {
    const stale = offer({ expiresAt: hours(-1) });
    expect(isJobOfferExpired(stale, { now: NOW })).toBe(true);
    expect(effectiveJobOfferStatus(stale, { now: NOW })).toBe("expired");
    expect(canApplicantRespondToJobOffer(stale, { now: NOW })).toBe(false);
  });

  it("leaves an answered offer alone even if the deadline has passed", () => {
    const accepted = offer({ status: "accepted", expiresAt: hours(-100) });
    expect(isJobOfferExpired(accepted, { now: NOW })).toBe(false);
    expect(effectiveJobOfferStatus(accepted, { now: NOW })).toBe("accepted");
  });

  it("keeps an offer with no deadline open indefinitely", () => {
    const open = offer({ expiresAt: null });
    expect(isJobOfferExpired(open, { now: NOW })).toBe(false);
    expect(canApplicantRespondToJobOffer(open, { now: NOW })).toBe(true);
  });
});

describe("canSetJobOfferStatus", () => {
  it("lets the candidate accept or decline a sent offer", () => {
    expect(canSetJobOfferStatus("sent", "accepted", "applicant")).toBe(true);
    expect(canSetJobOfferStatus("sent", "declined", "applicant")).toBe(true);
  });

  it("does not let the candidate withdraw or the employer accept", () => {
    expect(canSetJobOfferStatus("sent", "withdrawn", "applicant")).toBe(false);
    expect(canSetJobOfferStatus("sent", "accepted", "employer")).toBe(false);
  });

  it("refuses to move an answered offer", () => {
    expect(canSetJobOfferStatus("accepted", "declined", "applicant")).toBe(
      false,
    );
    expect(canSetJobOfferStatus("declined", "accepted", "applicant")).toBe(
      false,
    );
    expect(canSetJobOfferStatus("withdrawn", "accepted", "applicant")).toBe(
      false,
    );
  });

  it("only lets the employer withdraw before an answer", () => {
    expect(canEmployerWithdrawJobOffer(offer())).toBe(true);
    expect(canEmployerWithdrawJobOffer(offer({ status: "accepted" }))).toBe(
      false,
    );
  });
});

describe("hasOpenJobOffer", () => {
  it("blocks a second live offer on the same application", () => {
    expect(hasOpenJobOffer([offer()], { now: NOW })).toBe(true);
  });

  it("allows a new offer once the previous one is closed out or stale", () => {
    expect(hasOpenJobOffer([offer({ status: "declined" })], { now: NOW })).toBe(
      false,
    );
    expect(
      hasOpenJobOffer([offer({ expiresAt: hours(-1) })], { now: NOW }),
    ).toBe(false);
    expect(hasOpenJobOffer([], { now: NOW })).toBe(false);
  });
});

describe("normalizeJobOfferExpiry", () => {
  it("defaults to the standard window when nothing is given", () => {
    expect(normalizeJobOfferExpiry(undefined, { now: NOW })).toBe(
      new Date(
        NOW.getTime() + JOB_OFFER_DEFAULT_EXPIRY_DAYS * 86400_000,
      ).toISOString(),
    );
  });

  it("pushes a too-soon deadline out to the minimum", () => {
    expect(normalizeJobOfferExpiry(hours(-5), { now: NOW })).toBe(
      new Date(
        NOW.getTime() + JOB_OFFER_MIN_EXPIRY_MINUTES * 60_000,
      ).toISOString(),
    );
  });

  it("caps a far-future deadline", () => {
    expect(normalizeJobOfferExpiry(hours(24 * 365), { now: NOW })).toBe(
      new Date(
        NOW.getTime() + JOB_OFFER_MAX_EXPIRY_DAYS * 86400_000,
      ).toISOString(),
    );
  });

  it("keeps a deadline that is already inside the window", () => {
    expect(normalizeJobOfferExpiry(hours(72), { now: NOW })).toBe(hours(72));
  });
});

describe("normalizeJobOfferStartDate", () => {
  it("reduces a timestamp to a date so no timezone drift is stored", () => {
    expect(normalizeJobOfferStartDate("2026-09-01T23:30:00.000Z")).toBe(
      "2026-09-01",
    );
  });

  it("returns null for junk instead of inventing a date", () => {
    expect(normalizeJobOfferStartDate("not a date")).toBeNull();
    expect(normalizeJobOfferStartDate(undefined)).toBeNull();
  });
});

describe("canAutoCloseJobPostingOnHire", () => {
  it("closes a live posting but never touches a moderated one", () => {
    expect(canAutoCloseJobPostingOnHire("active")).toBe(true);
    expect(canAutoCloseJobPostingOnHire("paused")).toBe(true);
    expect(canAutoCloseJobPostingOnHire("closed")).toBe(false);
    expect(canAutoCloseJobPostingOnHire("suspended_by_admin")).toBe(false);
    expect(canAutoCloseJobPostingOnHire("removed_by_admin")).toBe(false);
  });
});

describe("describeJobOffer", () => {
  it("summarizes pay and start date", () => {
    expect(
      describeJobOffer(
        { compensation: offer().compensation, startDate: "2026-09-01" },
        { locale: "en-US" },
      ),
    ).toBe("NGN 150000 · starts Sep 1");
  });

  it("omits the start date when none was agreed", () => {
    expect(
      describeJobOffer({ compensation: offer().compensation, startDate: null }),
    ).toBe("NGN 150000");
  });
});

describe("describeJobOfferDeadline", () => {
  it("counts down in the largest useful unit", () => {
    expect(
      describeJobOfferDeadline(offer({ expiresAt: hours(72) }), { now: NOW }),
    ).toBe("3 days left");
    expect(
      describeJobOfferDeadline(offer({ expiresAt: hours(5) }), { now: NOW }),
    ).toBe("5 hours left");
    expect(
      describeJobOfferDeadline(offer({ expiresAt: hours(0.25) }), { now: NOW }),
    ).toBe("Less than an hour left");
  });

  it("says expired once the deadline is behind us", () => {
    expect(
      describeJobOfferDeadline(offer({ expiresAt: hours(-1) }), { now: NOW }),
    ).toBe("Expired");
  });

  it("has nothing to say about an answered offer", () => {
    expect(describeJobOfferDeadline(offer({ status: "accepted" }))).toBeNull();
  });
});
