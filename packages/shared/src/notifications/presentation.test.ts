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
