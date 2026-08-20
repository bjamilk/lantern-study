/**
 * Unit tests for the jobs-board input validators added by the security and
 * validation audit: SSRF-safe ATS webhook URLs, employer status whitelisting,
 * pay sanity, apply-link validity, deadline enforcement, interview-stage
 * advancement, and the private-field strip for public posting payloads.
 */
import {
  applicationStatusUpdateError,
  atsWebhookUrlError,
  isValidHttpUrl,
  jobPostingDeadlinePassed,
  normalizeCompensation,
  shouldAdvanceApplicationToInterview,
  stripPrivatePostingFields,
} from "./jobsBoard";

describe("atsWebhookUrlError (SSRF guard)", () => {
  it("accepts a plain public https endpoint", () => {
    expect(atsWebhookUrlError("https://ats.example.com/hooks/lantern")).toBeNull();
    expect(atsWebhookUrlError("https://hooks.greenhouse.io/v1/apps?token=abc")).toBeNull();
  });

  it("rejects non-https schemes", () => {
    expect(atsWebhookUrlError("http://ats.example.com/hook")).toMatch(/https/);
    expect(atsWebhookUrlError("ftp://ats.example.com/hook")).toMatch(/https/);
    expect(atsWebhookUrlError("file:///etc/passwd")).toMatch(/https/);
  });

  it("rejects unparseable URLs", () => {
    expect(atsWebhookUrlError("not a url")).toMatch(/valid URL/);
  });

  it("rejects embedded credentials", () => {
    expect(atsWebhookUrlError("https://user:pw@ats.example.com/hook")).toMatch(
      /credentials/,
    );
    expect(atsWebhookUrlError("https://token@ats.example.com/hook")).toMatch(
      /credentials/,
    );
  });

  it("rejects IP literals, including internal metadata and loopback targets", () => {
    for (const url of [
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://192.168.1.1/hook",
      "https://8.8.8.8/hook",
      "https://[::1]/hook",
      "https://[fd00::1]/hook",
      "https://0x7f.0.0.1/hook",
    ]) {
      expect(atsWebhookUrlError(url)).toMatch(/public host/);
    }
  });

  it("rejects localhost and internal-only hostnames", () => {
    for (const url of [
      "https://localhost/hook",
      "https://localhost:8443/hook",
      "https://api.localhost/hook",
      "https://ats.local/hook",
      "https://vault.internal/hook",
      "https://intranet-service/hook", // single label, unroutable publicly
      "https://printer.lan/hook",
      "https://nas.home.arpa/hook",
    ]) {
      expect(atsWebhookUrlError(url)).toMatch(/public host/);
    }
  });
});

describe("normalizeCompensation (pay sanity)", () => {
  it("keeps a valid paid NGN range", () => {
    expect(
      normalizeCompensation({
        kind: "paid",
        currency: "NGN",
        amountMin: 50_000,
        amountMax: 80_000,
        period: "month",
      } as any),
    ).toMatchObject({ kind: "paid", amountMin: 50_000, amountMax: 80_000 });
  });

  it("rejects negative amounts", () => {
    expect(() =>
      normalizeCompensation({
        kind: "paid",
        amountMin: -5,
        period: "month",
      } as any),
    ).toThrow(/amountMin/);
  });

  it("rejects non-numeric and non-finite amounts", () => {
    expect(() =>
      normalizeCompensation({
        kind: "paid",
        amountMin: "50000",
        period: "month",
      } as any),
    ).toThrow(/amountMin/);
    expect(() =>
      normalizeCompensation({
        kind: "paid",
        amountMax: Infinity,
        amountMin: 1,
        period: "month",
      } as any),
    ).toThrow(/amountMax/);
  });

  it("rejects amountMax below amountMin", () => {
    expect(() =>
      normalizeCompensation({
        kind: "paid",
        amountMin: 80_000,
        amountMax: 50_000,
        period: "month",
      } as any),
    ).toThrow(/amountMax/);
  });

  it("rejects any currency other than NGN, on every kind", () => {
    expect(() =>
      normalizeCompensation({
        kind: "paid",
        currency: "USD",
        amountMin: 100,
        period: "month",
      } as any),
    ).toThrow(/NGN/);
    expect(() =>
      normalizeCompensation({ kind: "discuss", currency: "ZZZ" } as any),
    ).toThrow(/NGN/);
  });

  it("still defaults a missing currency to NGN", () => {
    expect(normalizeCompensation({ kind: "discuss" } as any)).toMatchObject({
      currency: "NGN",
    });
  });
});

describe("isValidHttpUrl", () => {
  it("accepts http and https links only", () => {
    expect(isValidHttpUrl("https://jobs.example.com/apply")).toBe(true);
    expect(isValidHttpUrl("http://jobs.example.com/apply")).toBe(true);
    expect(isValidHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isValidHttpUrl("apply here")).toBe(false);
  });
});

describe("stripPrivatePostingFields", () => {
  it("removes the ATS wiring and nothing else", () => {
    const posting = {
      id: "p1",
      title: "Barista",
      externalUrl: "https://cafe.example.com/apply",
      atsProvider: "custom",
      atsExternalId: "ext-1",
      atsWebhookUrl: "https://ats.example.com/hook",
    };
    const clean = stripPrivatePostingFields(posting) as Record<string, unknown>;
    expect(clean).not.toHaveProperty("atsWebhookUrl");
    expect(clean).not.toHaveProperty("atsProvider");
    expect(clean).not.toHaveProperty("atsExternalId");
    expect(clean).toMatchObject({
      id: "p1",
      title: "Barista",
      externalUrl: "https://cafe.example.com/apply",
    });
    // The original object is untouched — owner-facing paths reuse it.
    expect(posting.atsWebhookUrl).toBe("https://ats.example.com/hook");
  });

  it("passes null through for callers mapping optional rows", () => {
    expect(stripPrivatePostingFields(null)).toBeNull();
  });
});

describe("jobPostingDeadlinePassed", () => {
  it("is false without a deadline or with garbage", () => {
    expect(jobPostingDeadlinePassed(null)).toBe(false);
    expect(jobPostingDeadlinePassed(undefined)).toBe(false);
    expect(jobPostingDeadlinePassed("not-a-date")).toBe(false);
  });

  it("is false while the deadline is still ahead", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(jobPostingDeadlinePassed(future)).toBe(false);
  });

  it("is true once the deadline is behind us", () => {
    expect(jobPostingDeadlinePassed("2020-01-01T00:00:00Z")).toBe(true);
  });
});

describe("shouldAdvanceApplicationToInterview", () => {
  it("advances only earlier-stage applications", () => {
    for (const status of ["interested", "chatting", "new", "reviewing"]) {
      expect(shouldAdvanceApplicationToInterview(status)).toBe(true);
    }
  });

  it("never rewinds later or terminal stages", () => {
    for (const status of [
      "interview",
      "offer",
      "hired",
      "rejected",
      "withdrawn",
      undefined,
      "garbage",
    ]) {
      expect(shouldAdvanceApplicationToInterview(status)).toBe(false);
    }
  });
});

describe("applicationStatusUpdateError", () => {
  it("rejects statuses that are not real JobApplicationStatus values", () => {
    expect(applicationStatusUpdateError("archived")).toMatch(/Unknown/);
    expect(applicationStatusUpdateError("")).toMatch(/Unknown/);
    expect(applicationStatusUpdateError(42)).toMatch(/Unknown/);
    expect(
      applicationStatusUpdateError("nonsense", { asApplicant: true }),
    ).toMatch(/Unknown/);
  });

  it("blocks employers from candidate-owned states", () => {
    for (const status of ["withdrawn", "interested", "chatting"]) {
      expect(applicationStatusUpdateError(status)).toMatch(/Employers cannot/);
    }
  });

  it("allows employers every hiring-stage status", () => {
    for (const status of [
      "new",
      "reviewing",
      "interview",
      "offer",
      "hired",
      "rejected",
    ]) {
      expect(applicationStatusUpdateError(status)).toBeNull();
    }
  });

  it("keeps the applicant withdraw path open", () => {
    expect(
      applicationStatusUpdateError("withdrawn", { asApplicant: true }),
    ).toBeNull();
  });
});
