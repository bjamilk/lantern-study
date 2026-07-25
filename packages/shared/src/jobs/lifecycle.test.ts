import {
  canEmployerSetJobPostingStatus,
  isJobPostingEditable,
  isJobPostingLinkVisible,
  isJobPostingModerated,
  isJobPostingPubliclyVisible,
  isJobPostingStatus,
  jobPostingStatusActions,
} from "./lifecycle";

describe("job posting lifecycle transitions", () => {
  it("lets an employer publish, pause, close, and reopen", () => {
    expect(canEmployerSetJobPostingStatus("draft", "active")).toBe(true);
    expect(canEmployerSetJobPostingStatus("active", "paused")).toBe(true);
    expect(canEmployerSetJobPostingStatus("paused", "active")).toBe(true);
    expect(canEmployerSetJobPostingStatus("active", "closed")).toBe(true);
    expect(canEmployerSetJobPostingStatus("closed", "active")).toBe(true);
  });

  it("never lets an employer set a moderated status", () => {
    expect(canEmployerSetJobPostingStatus("active", "suspended_by_admin")).toBe(
      false,
    );
    expect(canEmployerSetJobPostingStatus("active", "removed_by_admin")).toBe(
      false,
    );
  });

  it("never lets an employer escape moderation", () => {
    expect(canEmployerSetJobPostingStatus("suspended_by_admin", "active")).toBe(
      false,
    );
    expect(canEmployerSetJobPostingStatus("removed_by_admin", "draft")).toBe(
      false,
    );
  });

  it("lets a pending post be withdrawn but not self-approved", () => {
    expect(
      canEmployerSetJobPostingStatus("pending_school_approval", "closed"),
    ).toBe(true);
    expect(
      canEmployerSetJobPostingStatus("pending_school_approval", "active"),
    ).toBe(false);
  });

  it("treats a no-op status change as allowed", () => {
    // Clients send the whole form back on save, including an unchanged status.
    expect(canEmployerSetJobPostingStatus("active", "active")).toBe(true);
    expect(
      canEmployerSetJobPostingStatus(
        "suspended_by_admin",
        "suspended_by_admin",
      ),
    ).toBe(true);
  });

  it("does not let a draft skip straight to paused", () => {
    expect(canEmployerSetJobPostingStatus("draft", "paused")).toBe(false);
  });
});

describe("job posting state helpers", () => {
  it("blocks content edits only for moderated posts", () => {
    expect(isJobPostingEditable("active")).toBe(true);
    expect(isJobPostingEditable("draft")).toBe(true);
    expect(isJobPostingEditable("pending_school_approval")).toBe(true);
    expect(isJobPostingEditable("suspended_by_admin")).toBe(false);
    expect(isJobPostingModerated("removed_by_admin")).toBe(true);
  });

  it("rejects unknown status values", () => {
    expect(isJobPostingStatus("active")).toBe(true);
    expect(isJobPostingStatus("banana")).toBe(false);
    expect(isJobPostingStatus(null)).toBe(false);
    expect(isJobPostingStatus(undefined)).toBe(false);
  });

  it("counts only active posts as publicly visible", () => {
    expect(isJobPostingPubliclyVisible("active")).toBe(true);
    expect(isJobPostingPubliclyVisible("paused")).toBe(false);
    expect(isJobPostingPubliclyVisible("draft")).toBe(false);
  });

  it("keeps paused and closed posts reachable by link, but not drafts", () => {
    // Past applicants revisit closed roles from their application list.
    expect(isJobPostingLinkVisible("paused")).toBe(true);
    expect(isJobPostingLinkVisible("closed")).toBe(true);
    expect(isJobPostingLinkVisible("draft")).toBe(false);
    expect(isJobPostingLinkVisible("removed_by_admin")).toBe(false);
    expect(isJobPostingLinkVisible("pending_school_approval")).toBe(false);
  });
});

describe("job posting status actions", () => {
  it("offers publish and close for a draft", () => {
    expect(jobPostingStatusActions("draft").map((a) => a.label)).toEqual([
      "Publish",
      "Close",
    ]);
  });

  it("relabels publish as reopen for closed and paused posts", () => {
    expect(jobPostingStatusActions("closed").map((a) => a.label)).toEqual([
      "Reopen",
    ]);
    expect(jobPostingStatusActions("paused").map((a) => a.label)).toEqual([
      "Reopen",
      "Close",
    ]);
  });

  it("offers nothing for a moderated post", () => {
    expect(jobPostingStatusActions("suspended_by_admin")).toEqual([]);
    expect(jobPostingStatusActions("removed_by_admin")).toEqual([]);
  });
});
