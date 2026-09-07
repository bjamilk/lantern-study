import {
  chunkPushMessages,
  isExpoPushToken,
  isJobPushEnabled,
  notifyJobTerminal,
  sendExpoPush,
  toExpoEnvelope,
  type ExpoPushEnvelope,
  type JobPushRecipient,
} from "./jobPush";

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
