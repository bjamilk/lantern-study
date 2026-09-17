import { processJobSavedSearchAlerts } from "./jobAlerts";
import type { DataLayer } from "./data";

type Row = Record<string, unknown>;

/**
 * Minimal stand-in for the Supabase query builder: every filter returns `this`
 * and the terminal call resolves the rows the test staged for that table.
 */
function buildClient(options: {
  searches: Row[];
  postings: Row[];
  notifications: Row[];
  onSearchUpdate: (patch: Row) => void;
}) {
  return {
    from(table: string) {
      if (table === "job_saved_searches") {
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          update: (patch: Row) => {
            options.onSearchUpdate(patch);
            return { eq: async () => ({ data: null, error: null }) };
          },
          then: (resolve: (value: unknown) => unknown) =>
            resolve({ data: options.searches, error: null }),
        };
        return builder;
      }
      if (table === "job_postings") {
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          gt: () => builder,
          order: () => builder,
          limit: async () => ({ data: options.postings, error: null }),
        };
        return builder;
      }
      if (table === "notifications") {
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          limit: async () => ({ data: options.notifications, error: null }),
        };
        return builder;
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function makePosting(overrides: Row = {}): Row {
  return {
    id: "posting-1",
    title: "Weekend maths tutor",
    description: "Teach secondary school maths.",
    employment_type: "part_time",
    is_remote: false,
    campus_id: null,
    company_id: null,
    compensation: { kind: "paid", currency: "NGN", amountMin: 50000 },
    created_at: "2026-07-20T10:00:00.000Z",
    ...overrides,
  };
}

function makeService(client: unknown, createNotification = jest.fn()) {
  return {
    getClient: () => client,
    notifications: {
      createNotification: createNotification.mockResolvedValue({
        id: "notification-1",
      }),
    },
  } as unknown as DataLayer;
}

describe("processJobSavedSearchAlerts", () => {
  const search = {
    id: "search-1",
    user_id: "user-1",
    name: "Tutoring",
    filters: { search: "tutor", employmentType: "part_time" },
    last_checked_at: "2026-07-19T10:00:00.000Z",
    created_at: "2026-07-01T10:00:00.000Z",
  };

  it("notifies the owner about a matching posting", async () => {
    const createNotification = jest.fn();
    const updates: Row[] = [];
    const client = buildClient({
      searches: [search],
      postings: [makePosting()],
      notifications: [],
      onSearchUpdate: (patch) => updates.push(patch),
    });

    const sent = await processJobSavedSearchAlerts(
      makeService(client, createNotification),
    );

    expect(sent).toBe(1);
    expect(createNotification).toHaveBeenCalledWith("user-1", {
      type: "job_alert",
      message: 'New match for "Tutoring": Weekend maths tutor',
      link: "/marketplace/jobs/posting-1",
      data: { savedSearchId: "search-1", postingId: "posting-1" },
    });
    // Watermark advances so the next run scans a smaller window.
    expect(updates).toHaveLength(1);
    expect(updates[0]).toHaveProperty("last_checked_at");
  });

  it("skips postings that do not match the saved filters", async () => {
    const createNotification = jest.fn();
    const updates: Row[] = [];
    const client = buildClient({
      searches: [search],
      postings: [
        makePosting({
          id: "posting-2",
          title: "Delivery rider",
          description: "Ride",
        }),
      ],
      notifications: [],
      onSearchUpdate: (patch) => updates.push(patch),
    });

    const sent = await processJobSavedSearchAlerts(
      makeService(client, createNotification),
    );

    expect(sent).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
    // Even with no matches the watermark moves forward.
    expect(updates).toHaveLength(1);
  });

  it("does not alert twice about the same posting", async () => {
    const createNotification = jest.fn();
    const client = buildClient({
      searches: [search],
      postings: [makePosting()],
      notifications: [
        { data: { savedSearchId: "search-1", postingId: "posting-1" } },
      ],
      onSearchUpdate: () => undefined,
    });

    const sent = await processJobSavedSearchAlerts(
      makeService(client, createNotification),
    );

    expect(sent).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("ignores notifications recorded for a different saved search", async () => {
    const createNotification = jest.fn();
    const client = buildClient({
      searches: [search],
      postings: [makePosting()],
      notifications: [
        { data: { savedSearchId: "search-other", postingId: "posting-1" } },
      ],
      onSearchUpdate: () => undefined,
    });

    const sent = await processJobSavedSearchAlerts(
      makeService(client, createNotification),
    );

    expect(sent).toBe(1);
  });
});
