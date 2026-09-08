/**
 * Behavioural tests for the jobs-board audit fixes, with Supabase mocked the
 * same way the marketplace payment security tests mock it: a chainable query
 * stub per table so we can assert what the service reads, writes, and — just
 * as important — refuses to write.
 */
import { JobsBoardService } from "./jobsBoard";

type ChainResult = { data?: unknown; error?: unknown; count?: number | null };

/**
 * A query-builder stub: every builder method returns the chain itself, the
 * chain records each call, and awaiting it (or .single()/.maybeSingle())
 * yields the canned result.
 */
function chain(result: ChainResult = { data: null, error: null }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const api: any = { calls };
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return api;
    };
  for (const method of [
    "select",
    "eq",
    "neq",
    "in",
    "or",
    "not",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "textSearch",
    "order",
    "range",
    "limit",
    "insert",
    "update",
    "upsert",
    "delete",
  ]) {
    api[method] = record(method);
  }
  api.maybeSingle = async () => result;
  api.single = async () => result;
  api.then = (resolve: any, reject: any) =>
    Promise.resolve(result).then(resolve, reject);
  return api;
}

function argOf(c: any, method: string): unknown {
  return c.calls.find((call: any) => call.method === method)?.args[0];
}

function callsTo(c: any, method: string): unknown[][] {
  return c.calls
    .filter((call: any) => call.method === method)
    .map((call: any) => call.args);
}

/** from(table) hands out the queued chains in order; extras get empty stubs. */
function makeClient(tables: Record<string, any[]>) {
  const used: Array<{ table: string; chain: any }> = [];
  return {
    used,
    from(table: string) {
      const queue = tables[table] || (tables[table] = []);
      const next = queue.length ? queue.shift() : chain();
      used.push({ table, chain: next });
      return next;
    },
    rpc: jest.fn(async () => ({ data: null, error: null })),
  };
}

function makeService(client: any) {
  const supabase = {
    getClient: () => client,
    createNotification: jest.fn(async () => undefined),
    sendDirectMessage: jest.fn(async () => undefined),
  };
  return { svc: new JobsBoardService(supabase as any), supabase };
}

const postingRow = (extra: Record<string, unknown> = {}) => ({
  id: "post-1",
  title: "Barista needed",
  description: "Serve coffee at the campus cafe.",
  employment_type: "part_time",
  status: "active",
  poster_user_id: "owner-1",
  company_id: null,
  compensation: { kind: "discuss", currency: "NGN" },
  apply_mode: "in_app",
  external_url: null,
  ats_provider: "custom",
  ats_external_id: "ext-9",
  ats_webhook_url: "https://ats.example.com/hook",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...extra,
});

describe("private ATS fields never leave the employer's own surfaces", () => {
  it("GET /postings list payloads carry no ATS wiring", async () => {
    const client = makeClient({
      job_postings: [chain({ data: [postingRow()], error: null, count: 1 })],
    });
    const { svc } = makeService(client);

    const result = await svc.listPostings({ sort: "newest", viewerId: null });
    expect(result.data).toHaveLength(1);
    const posting = result.data[0] as Record<string, unknown>;
    expect(posting.title).toBe("Barista needed");
    expect(posting).not.toHaveProperty("atsWebhookUrl");
    expect(posting).not.toHaveProperty("atsProvider");
    expect(posting).not.toHaveProperty("atsExternalId");
  });

  it("getPosting strips ATS fields for a stranger on the public view", async () => {
    const client = makeClient({
      job_postings: [chain({ data: postingRow(), error: null })],
      job_favorites: [chain({ data: [], error: null })],
      job_applications: [chain({ data: [], error: null })],
    });
    const { svc } = makeService(client);

    const posting = (await svc.getPosting("post-1", {
      viewerId: "someone-else",
      publicView: true,
    })) as Record<string, unknown>;
    expect(posting).not.toHaveProperty("atsWebhookUrl");
    expect(posting).not.toHaveProperty("atsProvider");
    expect(posting).not.toHaveProperty("atsExternalId");
  });

  it("getPosting keeps ATS fields for the poster (the edit form's load)", async () => {
    const client = makeClient({
      job_postings: [chain({ data: postingRow(), error: null })],
      job_favorites: [chain({ data: [], error: null })],
      job_applications: [chain({ data: [], error: null })],
    });
    const { svc } = makeService(client);

    const posting = (await svc.getPosting("post-1", {
      viewerId: "owner-1",
      publicView: true,
    })) as Record<string, unknown>;
    expect(posting.atsWebhookUrl).toBe("https://ats.example.com/hook");
    expect(posting.atsProvider).toBe("custom");
  });

  it("internal reads (no publicView) keep the row intact for the apply/webhook flow", async () => {
    const client = makeClient({
      job_postings: [chain({ data: postingRow(), error: null })],
    });
    const { svc } = makeService(client);

    const posting = (await svc.getPosting("post-1")) as Record<string, unknown>;
    expect(posting.atsWebhookUrl).toBe("https://ats.example.com/hook");
  });
});

describe("createPosting validation", () => {
  const baseInput = {
    title: "Barista needed",
    description: "Serve coffee at the campus cafe.",
    employmentType: "full_time" as const,
    compensation: { kind: "discuss" as const },
  };

  function createClient(capture: { inserted?: any } = {}) {
    const insertChain = chain({ data: { id: "post-1" }, error: null });
    const originalInsert = insertChain.insert;
    insertChain.insert = (payload: unknown) => {
      capture.inserted = payload;
      return originalInsert(payload);
    };
    return makeClient({
      job_postings: [insertChain, chain({ data: postingRow(), error: null })],
    });
  }

  it("rejects an SSRF-shaped atsWebhookUrl at create time", async () => {
    const { svc } = makeService(createClient());
    await expect(
      svc.createPosting("owner-1", {
        ...baseInput,
        atsWebhookUrl: "https://169.254.169.254/latest/meta-data",
      } as any),
    ).rejects.toThrow(/public host/);
    await expect(
      svc.createPosting("owner-1", {
        ...baseInput,
        atsWebhookUrl: "http://ats.example.com/hook",
      } as any),
    ).rejects.toThrow(/https/);
  });

  it("rejects external/both apply modes without a valid http(s) externalUrl", async () => {
    const { svc } = makeService(createClient());
    await expect(
      svc.createPosting("owner-1", {
        ...baseInput,
        applyMode: "external",
      } as any),
    ).rejects.toThrow(/externalUrl is required/);
    await expect(
      svc.createPosting("owner-1", {
        ...baseInput,
        applyMode: "both",
        externalUrl: "apply at our office",
      } as any),
    ).rejects.toThrow(/valid http/);
  });

  it("rejects junk compensation through the same path", async () => {
    const { svc } = makeService(createClient());
    await expect(
      svc.createPosting("owner-1", {
        ...baseInput,
        compensation: { kind: "paid", amountMin: -100, period: "month" },
      } as any),
    ).rejects.toThrow(/amountMin/);
  });

  it("blocks publishing template boilerplate but lets drafts keep placeholders", async () => {
    const capture: { inserted?: any } = {};
    const { svc } = makeService(createClient(capture));
    await expect(
      svc.createPosting("owner-1", {
        ...baseInput,
        title: "Internship — [team / function]",
      } as any),
    ).rejects.toThrow(/Replace/);

    await expect(
      svc.createPosting("owner-1", {
        ...baseInput,
        title: "Internship — [team / function]",
        status: "draft",
      } as any),
    ).resolves.toBeTruthy();
    expect(capture.inserted.status).toBe("draft");
  });

  it("keeps 'save as draft' a draft even when school approval is required", async () => {
    const capture: { inserted?: any } = {};
    const { svc } = makeService(createClient(capture));
    await svc.createPosting("owner-1", {
      ...baseInput,
      status: "draft",
      requiresSchoolApproval: true,
    } as any);
    expect(capture.inserted.status).toBe("draft");
    expect(capture.inserted.requires_school_approval).toBe(true);
  });

  it("still routes an actual publication into the school-approval queue", async () => {
    const capture: { inserted?: any } = {};
    const { svc } = makeService(createClient(capture));
    await svc.createPosting("owner-1", {
      ...baseInput,
      status: "active",
      requiresSchoolApproval: true,
    } as any);
    expect(capture.inserted.status).toBe("pending_school_approval");
  });
});

describe("updatePosting validation", () => {
  const existingPosting = {
    id: "post-1",
    title: "Barista needed",
    description: "Serve coffee at the campus cafe.",
    employmentType: "full_time",
    engagementDuration: null,
    status: "active",
    posterUserId: "owner-1",
    companyId: null,
    applyMode: "in_app",
    externalUrl: null,
    requiresSchoolApproval: false,
  };

  it("refuses a patch that strands the posting without an apply path", async () => {
    const { svc } = makeService(makeClient({}));
    jest.spyOn(svc, "getPosting").mockResolvedValue(existingPosting as any);
    await expect(
      svc.updatePosting("post-1", "owner-1", { applyMode: "external" }),
    ).rejects.toThrow(/externalUrl is required/);
    await expect(
      svc.updatePosting("post-1", "owner-1", {
        applyMode: "both",
        externalUrl: "not a link",
      }),
    ).rejects.toThrow(/valid http/);
  });

  it("validates atsWebhookUrl on patch too", async () => {
    const { svc } = makeService(makeClient({}));
    jest.spyOn(svc, "getPosting").mockResolvedValue(existingPosting as any);
    await expect(
      svc.updatePosting("post-1", "owner-1", {
        atsWebhookUrl: "https://127.0.0.1/exfil",
      }),
    ).rejects.toThrow(/public host/);
  });

  it("blocks editing an active posting into template boilerplate", async () => {
    const { svc } = makeService(makeClient({}));
    jest.spyOn(svc, "getPosting").mockResolvedValue(existingPosting as any);
    await expect(
      svc.updatePosting("post-1", "owner-1", {
        title: "Internship — [team / function]",
      }),
    ).rejects.toThrow(/Replace/);
  });

  it("routes publishing a school-approval draft into the approval queue", async () => {
    const updateChain = chain({ data: null, error: null });
    const client = makeClient({ job_postings: [updateChain] });
    const { svc } = makeService(client);
    jest.spyOn(svc, "getPosting").mockResolvedValue({
      ...existingPosting,
      status: "draft",
      requiresSchoolApproval: true,
    } as any);

    await svc.updatePosting("post-1", "owner-1", { status: "active" });
    const patch = argOf(updateChain, "update") as Record<string, unknown>;
    expect(patch.status).toBe("pending_school_approval");
  });
});

describe("schoolApprovePosting", () => {
  const queued = {
    id: "post-1",
    title: "Barista needed",
    description: "Serve coffee at the campus cafe.",
    status: "pending_school_approval",
    posterUserId: "owner-1",
    companyId: null,
  };

  it("refuses to publish boilerplate through the approval queue", async () => {
    // The third publish path. create and update both gate template
    // leftovers; this one wrote straight to the status column, so a posting
    // that entered the queue with "[team / function]" intact went live.
    const updateChain = chain({ data: null, error: null });
    const client = makeClient({ job_postings: [updateChain] });
    const { svc } = makeService(client);
    jest
      .spyOn(svc, "getPosting")
      .mockResolvedValue({ ...queued, title: "Internship — [team / function]" } as any);

    await expect(svc.schoolApprovePosting("post-1", true)).rejects.toThrow(/Replace/);
    // Refused means NOT written: no status update reached the table.
    expect(
      updateChain.calls.some((call: { method: string }) => call.method === "update"),
    ).toBe(false);
  });

  it("publishes a posting whose copy is real", async () => {
    const updateChain = chain({ data: null, error: null });
    const client = makeClient({ job_postings: [updateChain] });
    const { svc } = makeService(client);
    jest.spyOn(svc, "getPosting").mockResolvedValue(queued as any);

    await svc.schoolApprovePosting("post-1", true);
    const patch = argOf(updateChain, "update") as Record<string, unknown>;
    expect(patch.status).toBe("active");
  });

  it("still lets the school REJECT a posting, boilerplate or not", async () => {
    // Rejection closes the posting: refusing it over its copy would trap a
    // boilerplate posting in the queue for ever.
    const updateChain = chain({ data: null, error: null });
    const client = makeClient({ job_postings: [updateChain] });
    const { svc } = makeService(client);
    jest
      .spyOn(svc, "getPosting")
      .mockResolvedValue({ ...queued, title: "Internship — [team / function]" } as any);

    await svc.schoolApprovePosting("post-1", false);
    const patch = argOf(updateChain, "update") as Record<string, unknown>;
    expect(patch.status).toBe("closed");
  });
});

describe("expressApply / trackExternalApply deadline backstop", () => {
  const pastDeadline = "2020-01-01T00:00:00Z";

  it("rejects an apply after the deadline", async () => {
    const { svc } = makeService(makeClient({}));
    jest.spyOn(svc, "getPosting").mockResolvedValue({
      id: "post-1",
      status: "active",
      posterUserId: "owner-1",
      deadline: pastDeadline,
      applyMode: "in_app",
      companyId: null,
      company: null,
      title: "Barista needed",
    } as any);

    await expect(svc.expressApply("post-1", "candidate-1", {})).rejects.toThrow(
      /closed on 2020-01-01/,
    );
  });

  it("rejects external-apply tracking after the deadline", async () => {
    const { svc } = makeService(makeClient({}));
    jest.spyOn(svc, "getPosting").mockResolvedValue({
      id: "post-1",
      status: "active",
      posterUserId: "owner-1",
      deadline: pastDeadline,
      externalUrl: "https://jobs.example.com/apply",
      title: "Barista needed",
    } as any);

    await expect(svc.trackExternalApply("post-1", "candidate-1")).rejects.toThrow(
      /closed on 2020-01-01/,
    );
  });

  it("still accepts external-apply tracking before the deadline", async () => {
    const client = makeClient({
      job_external_apply_clicks: [chain({ data: null, error: null })],
      job_applications: [
        chain({ data: null, error: null }), // no existing application
        chain({ data: null, error: null }), // tracked insert
      ],
    });
    const { svc } = makeService(client);
    jest.spyOn(svc, "getPosting").mockResolvedValue({
      id: "post-1",
      status: "active",
      posterUserId: "owner-1",
      deadline: new Date(Date.now() + 86_400_000).toISOString(),
      externalUrl: "https://jobs.example.com/apply",
      title: "Barista needed",
    } as any);

    await expect(svc.trackExternalApply("post-1", "candidate-1")).resolves.toEqual(
      { url: "https://jobs.example.com/apply" },
    );
  });
});

describe("bulkUpdateApplicationStatus", () => {
  const posting = {
    id: "post-1",
    title: "Barista needed",
    posterUserId: "owner-1",
    companyId: null,
  };

  it("rejects candidate-owned statuses just like the single route", async () => {
    const { svc } = makeService(makeClient({}));
    await expect(
      svc.bulkUpdateApplicationStatus("post-1", "owner-1", ["a1"], "chatting"),
    ).rejects.toThrow(/hiring-stage/);
    await expect(
      svc.bulkUpdateApplicationStatus("post-1", "owner-1", ["a1"], "withdrawn"),
    ).rejects.toThrow(/hiring-stage/);
  });

  it("skips withdrawn applications instead of dragging them back", async () => {
    const listChain = chain({
      data: [
        { id: "a1", applicant_id: "cand-1", status: "withdrawn" },
        { id: "a2", applicant_id: "cand-2", status: "new" },
      ],
      error: null,
    });
    const updateChain = chain({
      data: [
        {
          id: "a2",
          posting_id: "post-1",
          applicant_id: "cand-2",
          status: "reviewing",
        },
      ],
      error: null,
    });
    const client = makeClient({ job_applications: [listChain, updateChain] });
    const { svc, supabase } = makeService(client);
    jest.spyOn(svc, "getPosting").mockResolvedValue(posting as any);

    const result = await svc.bulkUpdateApplicationStatus(
      "post-1",
      "owner-1",
      ["a1", "a2"],
      "reviewing",
    );

    expect(result.count).toBe(1);
    expect(result.skippedWithdrawn).toBe(1);
    // Only the non-withdrawn application is written…
    expect(callsTo(updateChain, "in")).toEqual([["id", ["a2"]]]);
    // …and only its candidate is notified.
    expect(supabase.createNotification).toHaveBeenCalledTimes(1);
    expect(supabase.createNotification).toHaveBeenCalledWith(
      "cand-2",
      expect.anything(),
    );
  });
});

describe("scheduleInterview stage guard", () => {
  const futureSlot = new Date(Date.now() + 7 * 86_400_000).toISOString();

  function interviewSetup(applicationStatus: string) {
    const appChain = chain({
      data: {
        id: "app-1",
        applicant_id: "cand-1",
        posting_id: "post-1",
        status: applicationStatus,
        posting: {
          id: "post-1",
          title: "Barista needed",
          poster_user_id: "owner-1",
          company_id: null,
        },
      },
      error: null,
    });
    const insertChain = chain({
      data: {
        id: "int-1",
        application_id: "app-1",
        posting_id: "post-1",
        applicant_id: "cand-1",
        created_by: "owner-1",
        mode: "video",
        status: "proposed",
        duration_minutes: 30,
        proposed_slots: [futureSlot],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      error: null,
    });
    const statusUpdateChain = chain({ data: null, error: null });
    const client = makeClient({
      job_applications: [appChain, statusUpdateChain],
      job_interviews: [insertChain],
    });
    return { client, statusUpdateChain };
  }

  it("advances an earlier-stage application to interview", async () => {
    const { client, statusUpdateChain } = interviewSetup("new");
    const { svc } = makeService(client);

    await svc.scheduleInterview("app-1", "owner-1", {
      proposedSlots: [futureSlot],
    });
    const patch = argOf(statusUpdateChain, "update") as Record<string, unknown>;
    expect(patch).toMatchObject({ status: "interview" });
  });

  it("never rewinds a hired application back to interview", async () => {
    const { client } = interviewSetup("hired");
    const { svc } = makeService(client);

    await svc.scheduleInterview("app-1", "owner-1", {
      proposedSlots: [futureSlot],
    });
    // The application row is read once and never written.
    const applicationWrites = client.used.filter(
      (entry) =>
        entry.table === "job_applications" &&
        entry.chain.calls.some((call: any) => call.method === "update"),
    );
    expect(applicationWrites).toHaveLength(0);
  });
});

describe("listMyPostings covers company recruiters", () => {
  it("includes postings from companies the user belongs to", async () => {
    const memberChain = chain({
      data: [{ company_id: "co-1" }],
      error: null,
    });
    const postingsChain = chain({
      data: [postingRow({ poster_user_id: "someone-else", company_id: "co-1" })],
      error: null,
    });
    const countsChain = chain({ data: [], error: null });
    const client = makeClient({
      job_company_members: [memberChain],
      job_postings: [postingsChain],
      job_applications: [countsChain],
    });
    const { svc } = makeService(client);

    const postings = await svc.listMyPostings("recruiter-1");
    expect(postings).toHaveLength(1);
    expect(argOf(postingsChain, "or")).toBe(
      "poster_user_id.eq.recruiter-1,company_id.in.(co-1)",
    );
  });

  it("keeps the plain poster filter for users with no company", async () => {
    const memberChain = chain({ data: [], error: null });
    const postingsChain = chain({ data: [postingRow()], error: null });
    const countsChain = chain({ data: [], error: null });
    const client = makeClient({
      job_company_members: [memberChain],
      job_postings: [postingsChain],
      job_applications: [countsChain],
    });
    const { svc } = makeService(client);

    await svc.listMyPostings("owner-1");
    expect(callsTo(postingsChain, "eq")).toEqual([
      ["poster_user_id", "owner-1"],
    ]);
    expect(callsTo(postingsChain, "or")).toEqual([]);
  });
});
