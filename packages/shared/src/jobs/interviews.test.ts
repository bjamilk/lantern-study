import {
  canApplicantRespondToJobInterview,
  canEmployerCompleteJobInterview,
  canEmployerRescheduleJobInterview,
  canSetJobInterviewStatus,
  clampJobInterviewDuration,
  describeJobInterviewSchedule,
  isJobInterviewUpcoming,
  JOB_INTERVIEW_DEFAULT_DURATION_MINUTES,
  JOB_INTERVIEW_MAX_SLOTS,
  matchJobInterviewSlot,
  nextJobInterviewSlot,
  normalizeJobInterviewSlots,
} from "./interviews";

const NOW = new Date("2026-08-01T12:00:00.000Z");

function iso(offsetHours: number): string {
  return new Date(NOW.getTime() + offsetHours * 3600_000).toISOString();
}

describe("normalizeJobInterviewSlots", () => {
  it("drops past times so candidates only see attendable slots", () => {
    const slots = normalizeJobInterviewSlots([iso(-2), iso(3)], { now: NOW });
    expect(slots).toEqual([iso(3)]);
  });

  it("sorts ascending and collapses duplicates at minute precision", () => {
    const slots = normalizeJobInterviewSlots(
      [
        iso(5),
        iso(2),
        "2026-08-01T14:00:30.000Z", // same minute as iso(2)
      ],
      { now: NOW },
    );
    expect(slots).toEqual([iso(2), iso(5)]);
  });

  it("ignores unparseable entries instead of failing the whole request", () => {
    const slots = normalizeJobInterviewSlots(
      [iso(1), "not a date", null, 42, {}],
      { now: NOW },
    );
    expect(slots).toEqual([iso(1)]);
  });

  it("caps the number of proposed slots", () => {
    const many = Array.from({ length: 12 }, (_, i) => iso(i + 1));
    expect(normalizeJobInterviewSlots(many, { now: NOW })).toHaveLength(
      JOB_INTERVIEW_MAX_SLOTS,
    );
  });

  it("returns an empty list for non-array input", () => {
    expect(normalizeJobInterviewSlots(undefined, { now: NOW })).toEqual([]);
    expect(normalizeJobInterviewSlots("tomorrow", { now: NOW })).toEqual([]);
  });
});

describe("clampJobInterviewDuration", () => {
  it("falls back to the default when the value is unusable", () => {
    expect(clampJobInterviewDuration(undefined)).toBe(
      JOB_INTERVIEW_DEFAULT_DURATION_MINUTES,
    );
    expect(clampJobInterviewDuration("abc")).toBe(
      JOB_INTERVIEW_DEFAULT_DURATION_MINUTES,
    );
  });

  it("clamps to the supported range and accepts numeric strings", () => {
    expect(clampJobInterviewDuration(5)).toBe(15);
    expect(clampJobInterviewDuration(10_000)).toBe(480);
    expect(clampJobInterviewDuration("45")).toBe(45);
    expect(clampJobInterviewDuration(45.4)).toBe(45);
  });
});

describe("job interview status transitions", () => {
  it("lets the candidate accept or decline only while times are proposed", () => {
    expect(canApplicantRespondToJobInterview("proposed")).toBe(true);
    expect(canApplicantRespondToJobInterview("confirmed")).toBe(false);
    expect(canSetJobInterviewStatus("proposed", "confirmed", "applicant")).toBe(
      true,
    );
    expect(canSetJobInterviewStatus("proposed", "declined", "applicant")).toBe(
      true,
    );
    expect(canSetJobInterviewStatus("confirmed", "declined", "applicant")).toBe(
      false,
    );
  });

  it("does not let a candidate cancel or complete an interview", () => {
    expect(canSetJobInterviewStatus("proposed", "cancelled", "applicant")).toBe(
      false,
    );
    expect(
      canSetJobInterviewStatus("confirmed", "completed", "applicant"),
    ).toBe(false);
  });

  it("lets the employer cancel from either live state", () => {
    expect(canSetJobInterviewStatus("proposed", "cancelled", "employer")).toBe(
      true,
    );
    expect(canSetJobInterviewStatus("confirmed", "cancelled", "employer")).toBe(
      true,
    );
  });

  it("only allows completing an interview the candidate confirmed", () => {
    expect(canEmployerCompleteJobInterview("confirmed")).toBe(true);
    expect(canEmployerCompleteJobInterview("proposed")).toBe(false);
    expect(canSetJobInterviewStatus("proposed", "completed", "employer")).toBe(
      false,
    );
  });

  it("treats cancelled and completed as terminal for everyone", () => {
    for (const actor of ["employer", "applicant"] as const) {
      expect(canSetJobInterviewStatus("cancelled", "confirmed", actor)).toBe(
        false,
      );
      expect(canSetJobInterviewStatus("completed", "cancelled", actor)).toBe(
        false,
      );
    }
  });

  it("allows rescheduling after the candidate declines the offered times", () => {
    expect(canEmployerRescheduleJobInterview("declined")).toBe(true);
    expect(canEmployerRescheduleJobInterview("cancelled")).toBe(false);
    expect(canEmployerRescheduleJobInterview("completed")).toBe(false);
  });
});

describe("matchJobInterviewSlot", () => {
  const offered = [iso(2), iso(5)];

  it("matches an offered slot ignoring sub-minute differences", () => {
    expect(matchJobInterviewSlot(offered, iso(2))).toBe(iso(2));
    expect(matchJobInterviewSlot(offered, "2026-08-01T14:00:59.999Z")).toBe(
      iso(2),
    );
    expect(matchJobInterviewSlot(offered, new Date(iso(5)))).toBe(iso(5));
  });

  it("refuses a time the employer never offered", () => {
    expect(matchJobInterviewSlot(offered, iso(3))).toBeNull();
    expect(matchJobInterviewSlot(offered, iso(-2))).toBeNull();
  });

  it("refuses unusable input instead of guessing", () => {
    expect(matchJobInterviewSlot(offered, undefined)).toBeNull();
    expect(matchJobInterviewSlot(offered, "whenever")).toBeNull();
    expect(matchJobInterviewSlot(offered, 42)).toBeNull();
    expect(matchJobInterviewSlot([], iso(2))).toBeNull();
  });
});

describe("nextJobInterviewSlot", () => {
  it("returns the confirmed time while it is still ahead", () => {
    const interview = {
      status: "confirmed" as const,
      scheduledAt: iso(4),
      proposedSlots: [iso(4)],
    };
    expect(nextJobInterviewSlot(interview, { now: NOW })).toBe(iso(4));
    expect(isJobInterviewUpcoming(interview, { now: NOW })).toBe(true);
  });

  it("reports nothing upcoming once the confirmed time has passed", () => {
    const interview = {
      status: "confirmed" as const,
      scheduledAt: iso(-1),
      proposedSlots: [],
    };
    expect(nextJobInterviewSlot(interview, { now: NOW })).toBeNull();
    expect(isJobInterviewUpcoming(interview, { now: NOW })).toBe(false);
  });

  it("returns the earliest future proposed slot while awaiting a response", () => {
    const interview = {
      status: "proposed" as const,
      scheduledAt: null,
      proposedSlots: [iso(-3), iso(6), iso(9)],
    };
    expect(nextJobInterviewSlot(interview, { now: NOW })).toBe(iso(6));
  });

  it("ignores declined and cancelled interviews", () => {
    for (const status of ["declined", "cancelled", "completed"] as const) {
      expect(
        nextJobInterviewSlot(
          { status, scheduledAt: iso(5), proposedSlots: [iso(5)] },
          { now: NOW },
        ),
      ).toBeNull();
    }
  });
});

describe("describeJobInterviewSchedule", () => {
  it("summarizes a confirmed interview with its duration", () => {
    const text = describeJobInterviewSchedule(
      {
        mode: "video",
        status: "confirmed",
        scheduledAt: iso(2),
        proposedSlots: [iso(2)],
        durationMinutes: 45,
      },
      { locale: "en-US" },
    );
    expect(text).toContain("Video call");
    expect(text).toContain("45 min");
  });

  it("counts the options while awaiting a candidate", () => {
    const text = describeJobInterviewSchedule(
      {
        mode: "phone",
        status: "proposed",
        scheduledAt: null,
        proposedSlots: [iso(2), iso(3), iso(4)],
        durationMinutes: 30,
      },
      { locale: "en-US" },
    );
    expect(text).toBe("Phone call · 3 times proposed (30 min)");
  });

  it("falls back to the status label for finished interviews", () => {
    const text = describeJobInterviewSchedule(
      {
        mode: "onsite",
        status: "cancelled",
        scheduledAt: null,
        proposedSlots: [],
        durationMinutes: 60,
      },
      { locale: "en-US" },
    );
    expect(text).toBe("In person · Cancelled");
  });
});
