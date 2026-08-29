import { getNotificationMeta, parseNotificationLink } from "./presentation";

describe("job notification links", () => {
  it("sends interview invites to the candidate's applications list", () => {
    expect(
      parseNotificationLink("/marketplace/applications", {
        type: "job_interview",
        link: "/marketplace/applications",
      }),
    ).toEqual({ type: "job_applications" });
  });

  it("sends an interview response to the employer pipeline for that posting", () => {
    expect(
      parseNotificationLink("/marketplace/employer/jobs/posting-1", {
        type: "job_interview_response",
        link: "/marketplace/employer/jobs/posting-1",
      }),
    ).toEqual({ type: "job_applicants", id: "posting-1" });
  });

  it("still routes plain application notifications to the pipeline", () => {
    expect(
      parseNotificationLink("/marketplace/employer/jobs/posting-2", {
        type: "job_application",
        link: "/marketplace/employer/jobs/posting-2",
      }),
    ).toEqual({ type: "job_applicants", id: "posting-2" });
  });

  it("routes a job alert to the posting itself", () => {
    expect(
      parseNotificationLink("/marketplace/jobs/posting-3", {
        type: "job_alert",
        link: "/marketplace/jobs/posting-3",
      }),
    ).toEqual({ type: "job", id: "posting-3" });
  });

  it("labels both sides of an interview as an interview", () => {
    for (const type of ["job_interview", "job_interview_response"]) {
      const meta = getNotificationMeta("/marketplace/applications", {
        type,
        link: "/marketplace/applications",
      });
      expect(meta.label).toBe("Interview");
    }
  });

  it("keeps the applications label for ordinary status changes", () => {
    const meta = getNotificationMeta("/marketplace/applications", {
      type: "job_application_status",
      link: "/marketplace/applications",
    });
    expect(meta.label).not.toBe("Interview");
  });

  it("sends an offer to the candidate's applications list", () => {
    expect(
      parseNotificationLink("/marketplace/applications", {
        type: "job_offer",
        link: "/marketplace/applications",
      }),
    ).toEqual({ type: "job_applications" });
  });

  it("sends an offer response to the employer pipeline for that posting", () => {
    expect(
      parseNotificationLink("/marketplace/employer/jobs/posting-4", {
        type: "job_offer_response",
        link: "/marketplace/employer/jobs/posting-4",
      }),
    ).toEqual({ type: "job_applicants", id: "posting-4" });
  });

  it("labels both sides of an offer as a job offer", () => {
    for (const [type, link] of [
      ["job_offer", "/marketplace/applications"],
      ["job_offer_response", "/marketplace/employer/jobs/posting-4"],
    ] as const) {
      const meta = getNotificationMeta(link, { type, link });
      expect(meta.label).toBe("Job offer");
    }
  });

  it("routes a reminder by its link, since each side gets a different one", () => {
    // The same notification type goes to both the candidate and the employer,
    // so the link is what decides where it lands.
    expect(
      parseNotificationLink("/marketplace/applications", {
        type: "job_interview_reminder",
        link: "/marketplace/applications",
      }),
    ).toEqual({ type: "job_applications" });
    expect(
      parseNotificationLink("/marketplace/employer/jobs/posting-5", {
        type: "job_interview_reminder",
        link: "/marketplace/employer/jobs/posting-5",
      }),
    ).toEqual({ type: "job_applicants", id: "posting-5" });
    expect(
      parseNotificationLink("/marketplace/employer/jobs/posting-6", {
        type: "job_offer_reminder",
        link: "/marketplace/employer/jobs/posting-6",
      }),
    ).toEqual({ type: "job_applicants", id: "posting-6" });
  });

  it("labels reminders distinctly from the events they chase", () => {
    expect(
      getNotificationMeta("/marketplace/applications", {
        type: "job_interview_reminder",
        link: "/marketplace/applications",
      }).label,
    ).toBe("Interview reminder");
    expect(
      getNotificationMeta("/marketplace/applications", {
        type: "job_offer_reminder",
        link: "/marketplace/applications",
      }).label,
    ).toBe("Offer expiring");
  });

  it("does not confuse a job offer with a marketplace goods offer", () => {
    expect(parseNotificationLink("marketplace:offer:offer-9")).toEqual({
      type: "offer",
      id: "offer-9",
    });
    expect(getNotificationMeta("marketplace:offer:offer-9").label).toBe(
      "Offer",
    );
  });
});

describe("colour-coded feature families", () => {
  it("codes duels red with a game icon, per challenge subtype", () => {
    const meta = getNotificationMeta(undefined, {
      type: "challenge_result",
      link: "challenge:c1",
    });
    expect(meta.iconKey).toBe("game");
    expect(meta.label).toBe("Duel result");
    expect(meta.accentColor).toBe("#dc2626");
  });

  it("codes order updates emerald with a receipt icon", () => {
    const meta = getNotificationMeta(undefined, {
      type: "marketplace_order_update",
    });
    expect(meta.iconKey).toBe("order");
    expect(meta.accentColor).toBe("#059669");
  });

  it("codes flashcards-due fuchsia even with no link", () => {
    const meta = getNotificationMeta(undefined, { type: "flashcards_due" });
    expect(meta.iconKey).toBe("flashcards");
    expect(meta.label).toBe("Flashcards due");
    expect(meta.accentColor).toBe("#c026d3");
  });

  it("codes test results blue", () => {
    const meta = getNotificationMeta(undefined, { type: "test_result" });
    expect(meta.iconKey).toBe("test");
    expect(meta.accentColor).toBe("#2563eb");
  });

  it("gives jobs the briefcase icon and keeps the teal family", () => {
    const meta = getNotificationMeta("/marketplace/jobs/p1", {
      type: "job_alert",
      link: "/marketplace/jobs/p1",
    });
    expect(meta.iconKey).toBe("briefcase");
    expect(meta.accentColor).toBe("#0f766e");
  });

  it("every branch carries an accent colour", () => {
    for (const probe of [
      undefined,
      { type: "warning" },
      { type: "dm_message", data: { senderId: "u1" } },
      { type: "group_invite", data: { groupId: "g1" } },
    ] as const) {
      const meta = getNotificationMeta(undefined, probe as never);
      expect(meta.accentColor).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("marketplace type families without tuple links", () => {
  it("codes a sale (marketplace_purchase) emerald with a receipt", () => {
    const meta = getNotificationMeta("marketplace:order:o1", {
      type: "marketplace_purchase",
      link: "marketplace:order:o1",
    });
    expect(meta.iconKey).toBe("order");
    expect(meta.label).toBe("Sale");
    expect(meta.accentColor).toBe("#059669");
  });

  it("codes a path-linked inquiry amber", () => {
    const meta = getNotificationMeta("/marketplace/inquiries/i1", {
      type: "marketplace_inquiry",
      link: "/marketplace/inquiries/i1",
    });
    expect(meta.label).toBe("Inquiry");
    expect(meta.accentColor).toBe("#d97706");
  });
});
