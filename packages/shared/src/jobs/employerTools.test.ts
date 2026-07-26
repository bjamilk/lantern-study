import {
  JOB_BULK_STATUS_MAX,
  JOB_EMPLOYER_BULK_STATUSES,
  JOB_MESSAGE_TEMPLATES,
  buildJobApplicantsCsv,
  escapeCsvCell,
  filterJobMessageTemplates,
  getJobMessageTemplate,
  isJobEmployerBulkStatus,
  jobApplicantsCsvFilename,
  normalizeBulkApplicationIds,
} from "./employerTools";

describe("employer bulk tools", () => {
  it("limits bulk statuses to employer triage moves", () => {
    expect(isJobEmployerBulkStatus("reviewing")).toBe(true);
    expect(isJobEmployerBulkStatus("rejected")).toBe(true);
    expect(isJobEmployerBulkStatus("withdrawn")).toBe(false);
    expect(isJobEmployerBulkStatus("new")).toBe(false);
    expect(JOB_EMPLOYER_BULK_STATUSES).not.toContain("withdrawn");
  });

  it("normalizes bulk ids and rejects oversize batches", () => {
    expect(normalizeBulkApplicationIds([" a ", "a", "", "b"])).toEqual([
      "a",
      "b",
    ]);
    expect(normalizeBulkApplicationIds([])).toBeNull();
    expect(normalizeBulkApplicationIds("nope")).toBeNull();
    const tooMany = Array.from({ length: JOB_BULK_STATUS_MAX + 1 }, (_, i) =>
      String(i),
    );
    expect(normalizeBulkApplicationIds(tooMany)).toBeNull();
    expect(
      normalizeBulkApplicationIds(
        Array.from({ length: JOB_BULK_STATUS_MAX }, (_, i) => String(i)),
      ),
    ).toHaveLength(JOB_BULK_STATUS_MAX);
  });

  it("escapes CSV cells and builds applicant rows with answers", () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("a,b")).toBe('"a,b"');

    const csv = buildJobApplicantsCsv(
      [
        {
          id: "app-1",
          status: "reviewing",
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-02T10:00:00.000Z",
          source: "in_app",
          resumeFilename: "cv.pdf",
          resumeUrl: null,
          answers: { q1: "Yes, 2 years", q2: 'Has "references"' },
          notesCount: 2,
          dmThreadId: "thread-1",
          applicant: {
            id: "u1",
            name: "Ada, Lovelace",
            username: "ada",
            avatarUrl: null,
          },
        },
      ],
      {
        postingTitle: "Campus tutor",
        questionLabels: { q1: "Experience", q2: "References" },
      },
    );

    const lines = csv.split("\n");
    expect(lines[0]).toContain("applicant_name");
    expect(lines[0]).toContain("answer_Experience");
    expect(lines[1]).toContain('"Ada, Lovelace"');
    expect(lines[1]).toContain("Under review");
    expect(lines[1]).toContain('"Has ""references"""');
  });

  it("slugifies export filenames", () => {
    expect(
      jobApplicantsCsvFilename(
        "Lab Assistant!",
        new Date("2026-07-25T12:00:00Z"),
      ),
    ).toBe("lab-assistant-2026-07-25.csv");
    expect(
      jobApplicantsCsvFilename(null, new Date("2026-07-25T12:00:00Z")),
    ).toBe("applicants-2026-07-25.csv");
  });

  it("filters and looks up message templates", () => {
    expect(JOB_MESSAGE_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    expect(
      filterJobMessageTemplates("interview").every(
        (t) => t.kind === "interview",
      ),
    ).toBe(true);
    expect(getJobMessageTemplate("note-strong-fit")?.label).toBe("Strong fit");
    expect(getJobMessageTemplate("missing")).toBeUndefined();
  });
});
