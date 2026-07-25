import {
  buildJobInterviewIcs,
  describeJobReminderLead,
  dueJobReminderLead,
  isJobInterviewRemindable,
  isJobOfferRemindable,
  jobInterviewGoogleCalendarUrl,
  jobInterviewIcsFilename,
  jobReminderKey,
  JOB_INTERVIEW_REMINDER_LEAD_MINUTES,
  JOB_OFFER_REMINDER_LEAD_MINUTES,
  minutesUntil,
} from "./reminders";

const NOW = new Date("2026-08-01T12:00:00.000Z");

function inMinutes(offset: number): string {
  return new Date(NOW.getTime() + offset * 60000).toISOString();
}

describe("dueJobReminderLead", () => {
  const leads = JOB_INTERVIEW_REMINDER_LEAD_MINUTES;

  it("sends only the most urgent crossed threshold", () => {
    // 30 minutes out has crossed both the day-before and hour-before marks;
    // firing both at once would be noise.
    expect(dueJobReminderLead(30, leads)).toBe(60);
  });

  it("sends the day-before round when only that mark is crossed", () => {
    expect(dueJobReminderLead(10 * 60, leads)).toBe(24 * 60);
  });

  it("stays quiet for something too far out", () => {
    expect(dueJobReminderLead(48 * 60, leads)).toBeNull();
  });

  it("stays quiet once the moment has passed", () => {
    expect(dueJobReminderLead(0, leads)).toBeNull();
    expect(dueJobReminderLead(-15, leads)).toBeNull();
  });

  it("has nothing to say when there is no time to measure", () => {
    expect(dueJobReminderLead(null, leads)).toBeNull();
  });

  it("gives a late-scheduled event its one useful nudge", () => {
    // Booked 20 minutes ahead: the day-before round never applied, but the
    // candidate should still hear about it.
    expect(dueJobReminderLead(20, leads)).toBe(60);
  });

  it("uses the offer window for offers", () => {
    expect(dueJobReminderLead(90, JOB_OFFER_REMINDER_LEAD_MINUTES)).toBe(
      2 * 60,
    );
    expect(dueJobReminderLead(20 * 60, JOB_OFFER_REMINDER_LEAD_MINUTES)).toBe(
      24 * 60,
    );
  });
});

describe("minutesUntil", () => {
  it("measures forward and backward from now", () => {
    expect(minutesUntil(inMinutes(90), { now: NOW })).toBe(90);
    expect(minutesUntil(inMinutes(-30), { now: NOW })).toBe(-30);
  });

  it("returns null for missing or unparseable times", () => {
    expect(minutesUntil(null, { now: NOW })).toBeNull();
    expect(minutesUntil("not a time", { now: NOW })).toBeNull();
  });
});

describe("jobReminderKey", () => {
  it("tracks each round independently so neither can resend", () => {
    expect(jobReminderKey("interview", "abc", 60)).toBe("interview:abc:60m");
    expect(jobReminderKey("interview", "abc", 1440)).not.toBe(
      jobReminderKey("interview", "abc", 60),
    );
    expect(jobReminderKey("offer", "abc", 60)).not.toBe(
      jobReminderKey("interview", "abc", 60),
    );
  });
});

describe("describeJobReminderLead", () => {
  it("phrases the window the way a person would", () => {
    expect(describeJobReminderLead(24 * 60)).toBe("tomorrow");
    expect(describeJobReminderLead(60)).toBe("in 1 hour");
    expect(describeJobReminderLead(2 * 60)).toBe("in 2 hours");
    expect(describeJobReminderLead(30)).toBe("in 30 minutes");
  });
});

describe("remindability", () => {
  it("only treats a confirmed interview as a commitment", () => {
    expect(
      isJobInterviewRemindable({
        status: "confirmed",
        scheduledAt: inMinutes(60),
      }),
    ).toBe(true);
    expect(
      isJobInterviewRemindable({ status: "proposed", scheduledAt: null }),
    ).toBe(false);
    expect(
      isJobInterviewRemindable({
        status: "cancelled",
        scheduledAt: inMinutes(60),
      }),
    ).toBe(false);
  });

  it("only chases an offer that is still unanswered and has a deadline", () => {
    expect(
      isJobOfferRemindable({ status: "sent", expiresAt: inMinutes(60) }),
    ).toBe(true);
    expect(isJobOfferRemindable({ status: "sent", expiresAt: null })).toBe(
      false,
    );
    expect(
      isJobOfferRemindable({ status: "accepted", expiresAt: inMinutes(60) }),
    ).toBe(false);
  });
});

describe("buildJobInterviewIcs", () => {
  const event = {
    id: "int-1",
    title: "Interview: Frontend Intern",
    startsAt: "2026-08-03T14:30:00.000Z",
    durationMinutes: 45,
  };

  it("emits a single UTC event with a start and a derived end", () => {
    const ics = buildJobInterviewIcs(event, { now: NOW });
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("DTSTART:20260803T143000Z");
    expect(ics).toContain("DTEND:20260803T151500Z");
    expect(ics).toContain("DTSTAMP:20260801T120000Z");
    expect(ics).toContain("UID:job-interview-int-1@lanternstudy.com");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("uses CRLF line endings, which some calendar clients require", () => {
    expect(buildJobInterviewIcs(event, { now: NOW })).toContain(
      "BEGIN:VCALENDAR\r\nVERSION:2.0",
    );
  });

  it("escapes characters that would otherwise break the file", () => {
    const ics = buildJobInterviewIcs(
      {
        ...event,
        location: "Room 4, Block B; ask for Ada",
        description: "Bring a laptop.\nTwo rounds.",
      },
      { now: NOW },
    );
    expect(ics).toContain("LOCATION:Room 4\\, Block B\\; ask for Ada");
    expect(ics).toContain("DESCRIPTION:Bring a laptop.\\nTwo rounds.");
  });

  it("omits location and description when there are none", () => {
    const ics = buildJobInterviewIcs(event, { now: NOW });
    expect(ics).not.toContain("LOCATION:");
    expect(ics).not.toContain("DESCRIPTION:");
  });

  it("folds long lines so clients do not reject the file", () => {
    const ics = buildJobInterviewIcs(
      { ...event, location: `https://meet.example.com/${"a".repeat(120)}` },
      { now: NOW },
    );
    for (const line of ics.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
    // Folded continuations are marked with a leading space.
    expect(ics).toContain("\r\n a");
  });
});

describe("jobInterviewIcsFilename", () => {
  it("slugifies the job title", () => {
    expect(jobInterviewIcsFilename("Frontend Intern (Remote)")).toBe(
      "interview-frontend-intern-remote.ics",
    );
  });

  it("falls back when the title has nothing usable", () => {
    expect(jobInterviewIcsFilename("!!!")).toBe("interview-scheduled.ics");
  });
});

describe("jobInterviewGoogleCalendarUrl", () => {
  it("builds a prefilled event link with a UTC range", () => {
    const url = jobInterviewGoogleCalendarUrl({
      id: "int-1",
      title: "Interview: Frontend Intern",
      startsAt: "2026-08-03T14:30:00.000Z",
      durationMinutes: 30,
      location: "Remote",
    });
    expect(url).toContain("action=TEMPLATE");
    expect(url).toContain("dates=20260803T143000Z%2F20260803T150000Z");
    expect(url).toContain("location=Remote");
  });
});
