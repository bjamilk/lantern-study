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
});
