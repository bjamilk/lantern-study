import {
  chunkPushMessages,
  isExpoPushToken,
  isJobPushEnabled,
  notifyJobTerminal,
  parseExpoTickets,
  sendExpoPush,
  toExpoEnvelope,
  type ExpoPushEnvelope,
  type JobPushRecipient,
} from "./jobPush";
import type { JobPushAudit } from "@lantern/shared/jobs/jobState";

const RECIPIENT: JobPushRecipient = {
  tokens: ["ExponentPushToken[abc]"],
  settings: { notifications: { pushEnabled: true } },
};

function deps(overrides: Partial<Parameters<typeof notifyJobTerminal>[1]> = {}) {
  const sent: ExpoPushEnvelope[][] = [];
  return {
    sent,
    deps: {
      claim: jest.fn(async () => true),
      getRecipient: jest.fn(async () => RECIPIENT),
      send: jest.fn(async (envelopes: ExpoPushEnvelope[]) => {
        sent.push(envelopes);
        return envelopes.length;
      }),
      ...overrides,
    },
  };
}

describe("isJobPushEnabled", () => {
  const original = process.env.JOB_PUSH_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.JOB_PUSH_ENABLED;
    else process.env.JOB_PUSH_ENABLED = original;
  });

  it("defaults on", () => {
    delete process.env.JOB_PUSH_ENABLED;
    expect(isJobPushEnabled()).toBe(true);
  });

  it("turns off for the documented falsey values only", () => {
    for (const value of ["false", "FALSE", "0", "off", "no"]) {
      process.env.JOB_PUSH_ENABLED = value;
      expect(isJobPushEnabled()).toBe(false);
    }
    for (const value of ["true", "1", "on", ""]) {
      process.env.JOB_PUSH_ENABLED = value;
      expect(isJobPushEnabled()).toBe(true);
    }
  });
});

describe("isExpoPushToken", () => {
  it("accepts only Expo tokens", () => {
    expect(isExpoPushToken("ExponentPushToken[xyz]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[xyz]")).toBe(true);
    expect(isExpoPushToken("fcm-raw-token")).toBe(false);
    expect(isExpoPushToken(null)).toBe(false);
  });
});

describe("chunkPushMessages", () => {
  it("batches at the Expo limit", () => {
    const chunks = chunkPushMessages(new Array(250).fill("t"));
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
  });

  it("never loops forever on a nonsense size", () => {
    expect(chunkPushMessages([1, 2], 0)).toEqual([[1], [2]]);
  });
});

describe("sendExpoPush", () => {
  it("posts every batch and reports what a 2xx accepted", async () => {
    const calls: unknown[] = [];
    const fetchImpl = jest.fn(async (_url: string, init: Record<string, unknown>) => {
      calls.push(JSON.parse(init.body as string));
      return { ok: true, status: 200 };
    });
    const envelopes = new Array(150)
      .fill(null)
      .map((_, i) =>
        toExpoEnvelope(`ExponentPushToken[${i}]`, {
          title: "t",
          body: "b",
          data: { type: "x", jobId: "j", kind: "flashcards", stage: "done", url: "u" },
        } as never),
      );
    const delivered = await sendExpoPush(envelopes, fetchImpl as never);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(delivered).toBe(150);
  });

  it("swallows a transport failure instead of throwing at the queue", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error("network down");
    });
    await expect(
      sendExpoPush([{ to: "ExponentPushToken[a]", title: "t", body: "b", data: {} }], fetchImpl as never),
    ).resolves.toBe(0);
  });

  it("does not call out at all with nothing to send", async () => {
    const fetchImpl = jest.fn();
    await expect(sendExpoPush([], fetchImpl as never)).resolves.toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("notifyJobTerminal", () => {
  it("sends a finished generation to the owner's device", async () => {
    const { deps: d, sent } = deps();
    await expect(
      notifyJobTerminal(
        {
          id: "job-1",
          userId: "user-1",
          kind: "flashcards",
          stage: "done",
          result: { flashcards: new Array(10).fill({}) },
          resultRef: { type: "deck", id: "deck-1" },
          sourceTitle: "SDOH",
        },
        d,
      ),
    ).resolves.toBe("sent");
    expect(sent[0][0].title).toBe("10 flashcards ready · SDOH");
    expect(sent[0][0].data.url).toBe("lanternstudy://deck/deck-1");
    expect(sent[0][0].to).toBe("ExponentPushToken[abc]");
  });

  it("only buzzes once per (job, stage) — the second caller loses the claim", async () => {
    let claims = 0;
    const { deps: d } = deps({
      claim: jest.fn(async () => {
        claims += 1;
        return claims === 1;
      }),
    });
    const job = { id: "job-2", userId: "u", kind: "flashcards" as const, stage: "done" as const };
    await expect(notifyJobTerminal(job, d)).resolves.toBe("sent");
    await expect(notifyJobTerminal(job, d)).resolves.toBe("already_sent");
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it("claims separately for a different terminal stage", async () => {
    const seen = new Set<string>();
    const { deps: d } = deps({
      claim: jest.fn(async (jobId: string, stage: string) => {
        const key = `${jobId}:${stage}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    });
    await expect(
      notifyJobTerminal({ id: "j", userId: "u", kind: "quiz", stage: "done" }, d),
    ).resolves.toBe("sent");
    await expect(
      notifyJobTerminal({ id: "j", userId: "u", kind: "quiz", stage: "failed" }, d),
    ).resolves.toBe("sent");
  });

  it("respects the kill switch", async () => {
    process.env.JOB_PUSH_ENABLED = "false";
    const { deps: d } = deps();
    await expect(
      notifyJobTerminal({ id: "j", userId: "u", kind: "flashcards", stage: "done" }, d),
    ).resolves.toBe("disabled");
    expect(d.send).not.toHaveBeenCalled();
    delete process.env.JOB_PUSH_ENABLED;
  });

  it("stays quiet for a job nobody owns, a device-less student, or push turned off", async () => {
    const noOwner = deps();
    await expect(
      notifyJobTerminal({ id: "j", kind: "flashcards", stage: "done" }, noOwner.deps),
    ).resolves.toBe("no_owner");

    const noToken = deps({ getRecipient: jest.fn(async () => ({ tokens: [], settings: {} })) });
    await expect(
      notifyJobTerminal({ id: "j", userId: "u", kind: "flashcards", stage: "done" }, noToken.deps),
    ).resolves.toBe("no_token");

    const off = deps({
      getRecipient: jest.fn(async () => ({
        tokens: ["ExponentPushToken[abc]"],
        settings: { notifications: { pushEnabled: false } },
      })),
    });
    await expect(
      notifyJobTerminal({ id: "j", userId: "u", kind: "flashcards", stage: "done" }, off.deps),
    ).resolves.toBe("settings_off");
    expect(off.deps.send).not.toHaveBeenCalled();
  });

  it("does not claim a push it never sent", async () => {
    // Claiming before the settings/token checks would permanently silence a
    // student who turns push back on later.
    const { deps: d } = deps({ getRecipient: jest.fn(async () => ({ tokens: [], settings: {} })) });
    await notifyJobTerminal({ id: "j", userId: "u", kind: "flashcards", stage: "done" }, d);
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("says nothing for in-screen answers and cron work", async () => {
    const { deps: d } = deps();
    await expect(
      notifyJobTerminal({ id: "j", userId: "u", kind: "tutor", stage: "done" }, d),
    ).resolves.toBe("no_message");
    await expect(
      notifyJobTerminal({ id: "j", userId: "u", kind: "maintenance", stage: "done" }, d),
    ).resolves.toBe("no_message");
    expect(d.send).not.toHaveBeenCalled();
  });

  it("never lets a push failure escape to the job", async () => {
    const { deps: d } = deps({
      send: jest.fn(async () => {
        throw new Error("expo exploded");
      }),
    });
    await expect(
      notifyJobTerminal({ id: "j", userId: "u", kind: "flashcards", stage: "done" }, d),
    ).resolves.toBe("error");

    const brokenLookup = deps({
      getRecipient: jest.fn(async () => {
        throw new Error("db down");
      }),
    });
    await expect(
      notifyJobTerminal({ id: "j", userId: "u", kind: "flashcards", stage: "done" }, brokenLookup.deps),
    ).resolves.toBe("error");
  });
});

describe("parseExpoTickets", () => {
  it("reads Expo's per-message verdicts", () => {
    expect(
      parseExpoTickets({
        data: [
          { status: "ok", id: "ticket-1" },
          { status: "error", message: "DeviceNotRegistered" },
        ],
      }),
    ).toEqual([
      { status: "ok", id: "ticket-1" },
      { status: "error", message: "DeviceNotRegistered" },
    ]);
  });

  it("never returns a silent error", () => {
    // An error line with no message would look like a success in the audit.
    expect(parseExpoTickets({ data: [{ status: "error" }] })).toEqual([
      { status: "error", message: "Expo returned an error with no message." },
    ]);
  });

  it("shrugs at a body it does not recognise", () => {
    expect(parseExpoTickets(null)).toEqual([]);
    expect(parseExpoTickets({ data: "nope" })).toEqual([]);
  });
});

/**
 * On device a quiz finished and NO notification ever arrived — and nothing
 * anywhere could say whether the server had skipped the push, sent it, or been
 * refused by Expo. Every exit now writes that answer onto the job record.
 */
describe("notifyJobTerminal audit", () => {
  function auditDeps(overrides: Partial<Parameters<typeof notifyJobTerminal>[1]> = {}) {
    const written: Array<{ jobId: string; push: JobPushAudit }> = [];
    const base = deps(overrides);
    return {
      written,
      deps: {
        ...base.deps,
        recordPush: jest.fn(async (jobId: string, push: JobPushAudit) => {
          written.push({ jobId, push });
        }),
        now: () => new Date("2026-09-05T10:00:00.000Z"),
      },
      sent: base.sent,
    };
  }

  it("records the attempt, the device count, the link and Expo's tickets", async () => {
    const { deps: d, written } = auditDeps({
      send: jest.fn(async () => ({
        delivered: 1,
        tickets: [{ status: "ok" as const, id: "ticket-1" }],
      })),
    });
    await expect(
      notifyJobTerminal(
        {
          id: "job-q",
          userId: "u",
          kind: "quiz",
          stage: "done",
          resultRef: { type: "test", id: "test-9" },
        },
        d,
      ),
    ).resolves.toBe("sent");

    expect(written).toHaveLength(1);
    expect(written[0].jobId).toBe("job-q");
    expect(written[0].push).toEqual({
      attemptedAt: "2026-09-05T10:00:00.000Z",
      url: "lanternstudy://test/test-9",
      tokenCount: 1,
      expoTickets: [{ status: "ok", id: "ticket-1" }],
    });
    // A sent push has no skip reason — the tickets are the verdict.
    expect(written[0].push.skippedReason).toBeUndefined();
  });

  it("names the reason for every push that never left", async () => {
    const cases: Array<[Partial<Parameters<typeof notifyJobTerminal>[1]>, unknown, string]> = [
      [{ getRecipient: jest.fn(async () => ({ tokens: [], settings: {} })) }, {}, "no_token"],
      [
        {
          getRecipient: jest.fn(async () => ({
            tokens: ["ExponentPushToken[abc]"],
            settings: { notifications: { pushEnabled: false } },
          })),
        },
        {},
        "prefs_off",
      ],
      [{ claim: jest.fn(async () => false) }, {}, "claimed"],
      [{}, { kind: "tutor" }, "not_pushable"],
    ];

    for (const [overrides, jobPatch, expected] of cases) {
      const { deps: d, written } = auditDeps(overrides);
      await notifyJobTerminal(
        { id: "j", userId: "u", kind: "flashcards", stage: "done", ...(jobPatch as object) },
        d,
      );
      expect(written[0].push.skippedReason).toBe(expected);
    }
  });

  it("records a job with no owner, and the kill switch", async () => {
    const noOwner = auditDeps();
    await notifyJobTerminal({ id: "j", kind: "flashcards", stage: "done" }, noOwner.deps);
    expect(noOwner.written[0].push.skippedReason).toBe("no_owner");

    process.env.JOB_PUSH_ENABLED = "false";
    const disabled = auditDeps();
    await notifyJobTerminal({ id: "j", userId: "u", kind: "flashcards", stage: "done" }, disabled.deps);
    expect(disabled.written[0].push.skippedReason).toBe("disabled");
    delete process.env.JOB_PUSH_ENABLED;
  });

  it("keeps the thrown message, and a failed audit write never fails the push", async () => {
    const { deps: d, written } = auditDeps({
      send: jest.fn(async () => {
        throw new Error("expo exploded");
      }),
    });
    await expect(
      notifyJobTerminal({ id: "j", userId: "u", kind: "flashcards", stage: "done" }, d),
    ).resolves.toBe("error");
    expect(written[0].push).toMatchObject({ skippedReason: "error", error: "expo exploded" });

    const broken = deps();
    await expect(
      notifyJobTerminal(
        { id: "j", userId: "u", kind: "flashcards", stage: "done" },
        {
          ...broken.deps,
          recordPush: async () => {
            throw new Error("redis down");
          },
        },
      ),
    ).resolves.toBe("sent");
  });
});
