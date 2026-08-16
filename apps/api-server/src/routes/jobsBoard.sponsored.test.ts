/**
 * Regression guard: sponsored/featured placement sorts postings first and is
 * meant to be a paid slot, but the create/update routes used to write the
 * client's isSponsored flag straight to the DB — any poster could self-award
 * the Featured badge. The gate lives in sponsoredFieldsFor: only live platform
 * admins keep the fields; everyone else's values are dropped silently.
 */
const mockIsLivePlatformAdmin = jest.fn();

jest.mock("../utils/platformAdminAuth", () => ({
  isLivePlatformAdmin: (...args: unknown[]) => mockIsLivePlatformAdmin(...args),
}));

import { sponsoredFieldsFor } from "./jobsBoard";

describe("sponsoredFieldsFor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("drops sponsored fields from non-admin requests", async () => {
    mockIsLivePlatformAdmin.mockResolvedValue(false);
    await expect(
      sponsoredFieldsFor("user-1", {
        isSponsored: true,
        sponsoredUntil: "2027-01-01T00:00:00Z",
      }),
    ).resolves.toEqual({});
  });

  it("keeps sponsored fields for live platform admins", async () => {
    mockIsLivePlatformAdmin.mockResolvedValue(true);
    await expect(
      sponsoredFieldsFor("admin-1", {
        isSponsored: true,
        sponsoredUntil: "2027-01-01T00:00:00Z",
      }),
    ).resolves.toEqual({
      isSponsored: true,
      sponsoredUntil: "2027-01-01T00:00:00Z",
    });
  });

  it("lets an admin un-feature a posting", async () => {
    mockIsLivePlatformAdmin.mockResolvedValue(true);
    await expect(
      sponsoredFieldsFor("admin-1", { isSponsored: false }),
    ).resolves.toEqual({ isSponsored: false, sponsoredUntil: undefined });
  });

  it("skips the admin lookup entirely when no sponsored fields are sent", async () => {
    await expect(sponsoredFieldsFor("user-1", {})).resolves.toEqual({});
    expect(mockIsLivePlatformAdmin).not.toHaveBeenCalled();
  });
});
