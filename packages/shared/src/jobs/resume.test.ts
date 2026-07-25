import { describe, expect, it } from "vitest";
import {
  JOB_RESUME_MAX_BYTES,
  formatJobResumeSize,
  jobResumeExtension,
  jobResumeMimeType,
  validateJobResume,
} from "./resume";

describe("job resume validation", () => {
  it("accepts the supported document types", () => {
    expect(
      validateJobResume({
        name: "cv.pdf",
        size: 1024,
        type: "application/pdf",
      }),
    ).toBeNull();
    expect(validateJobResume({ name: "cv.DOCX", size: 1024 })).toBeNull();
  });

  it("rejects unsupported file types", () => {
    expect(
      validateJobResume({
        name: "headshot.png",
        size: 1024,
        type: "image/png",
      }),
    ).toMatch(/PDF, DOC, or DOCX/);
    expect(validateJobResume({ name: "resume", size: 1024 })).toMatch(
      /PDF, DOC, or DOCX/,
    );
  });

  it("rejects files past the bucket size limit", () => {
    expect(
      validateJobResume({ name: "cv.pdf", size: JOB_RESUME_MAX_BYTES + 1 }),
    ).toMatch(/smaller than/);
    expect(validateJobResume({ name: "cv.pdf", size: 0 })).toMatch(/empty/);
  });

  it("trusts the extension over a picker-reported type", () => {
    // Pickers frequently report octet-stream for documents.
    expect(jobResumeMimeType("cv.pdf", "application/octet-stream")).toBe(
      "application/pdf",
    );
    expect(jobResumeMimeType("cv.txt", "application/pdf")).toBe(
      "application/pdf",
    );
    expect(jobResumeMimeType("cv.txt", "text/plain")).toBeNull();
  });

  it("normalizes extensions and formats sizes", () => {
    expect(jobResumeExtension("My Resume.PDF")).toBe("pdf");
    expect(jobResumeExtension("noextension")).toBeNull();
    expect(formatJobResumeSize(2048)).toBe("2 KB");
    expect(formatJobResumeSize(JOB_RESUME_MAX_BYTES)).toBe("5.0 MB");
    expect(formatJobResumeSize(0)).toBeNull();
  });
});
