import {
  canEditJobCompanyProfile,
  canManageJobCompanyMembers,
  canRemoveJobCompanyMember,
  clampJobCompanyText,
  normalizeJobCompanyDomain,
  normalizeJobCompanyWebsite,
} from "./companies";

describe("job company helpers", () => {
  it("lets owners and recruiters edit the profile, owners manage members", () => {
    expect(canEditJobCompanyProfile("owner")).toBe(true);
    expect(canEditJobCompanyProfile("recruiter")).toBe(true);
    expect(canEditJobCompanyProfile(null)).toBe(false);
    expect(canManageJobCompanyMembers("owner")).toBe(true);
    expect(canManageJobCompanyMembers("recruiter")).toBe(false);
  });

  it("blocks removing yourself or another owner", () => {
    expect(
      canRemoveJobCompanyMember({
        actorRole: "owner",
        targetRole: "recruiter",
        actorUserId: "a",
        targetUserId: "b",
      }),
    ).toBe(true);
    expect(
      canRemoveJobCompanyMember({
        actorRole: "owner",
        targetRole: "recruiter",
        actorUserId: "a",
        targetUserId: "a",
      }),
    ).toBe(false);
    expect(
      canRemoveJobCompanyMember({
        actorRole: "owner",
        targetRole: "owner",
        actorUserId: "a",
        targetUserId: "b",
      }),
    ).toBe(false);
    expect(
      canRemoveJobCompanyMember({
        actorRole: "recruiter",
        targetRole: "recruiter",
        actorUserId: "a",
        targetUserId: "b",
      }),
    ).toBe(false);
  });

  it("normalizes websites and email domains", () => {
    expect(normalizeJobCompanyWebsite("example.com")).toBe("https://example.com");
    expect(normalizeJobCompanyWebsite("https://example.com/careers")).toBe(
      "https://example.com/careers",
    );
    expect(normalizeJobCompanyWebsite("  ")).toBeNull();
    expect(normalizeJobCompanyDomain("https://www.Acme.co/path")).toBe("acme.co");
    expect(normalizeJobCompanyDomain("not a domain")).toBeNull();
  });

  it("clamps optional text fields", () => {
    expect(clampJobCompanyText("  hello  ", 10)).toBe("hello");
    expect(clampJobCompanyText("abcdefghijk", 5)).toBe("abcde");
    expect(clampJobCompanyText("", 10)).toBeNull();
  });
});
