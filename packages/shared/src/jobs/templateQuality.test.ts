import {
  describeJobTemplateLeftovers,
  findJobTemplatePlaceholder,
  jobDescriptionIsTemplateHint,
} from "./templateQuality";
import { JOB_INTENT_TEMPLATES } from "./intents";

describe("job template quality gate", () => {
  it("finds unresolved bracketed placeholders", () => {
    expect(findJobTemplatePlaceholder("Internship — [team / function]")).toBe(
      "[team / function]",
    );
    expect(findJobTemplatePlaceholder("Tutor needed for [PHM 101]")).toBe(
      "[PHM 101]",
    );
    expect(findJobTemplatePlaceholder("Frontend intern, growth team")).toBeNull();
    expect(findJobTemplatePlaceholder(null)).toBeNull();
  });

  it("recognizes a description that is still the template hint", () => {
    expect(
      jobDescriptionIsTemplateHint(
        "Team, duration, location or remote, stipend if any, start date.",
      ),
    ).toBe(true);
    expect(
      jobDescriptionIsTemplateHint(
        "  team, duration,  location or remote, stipend if any, start date. ",
      ),
    ).toBe(true);
    expect(
      jobDescriptionIsTemplateHint(
        "Join our growth team for 3 months in Lagos. NGN 60k/month stipend.",
      ),
    ).toBe(false);
  });

  it("blocks every seeded template title or hint from publishing as-is", () => {
    for (const template of JOB_INTENT_TEMPLATES) {
      expect(
        describeJobTemplateLeftovers(template.title, template.descriptionHint),
      ).not.toBeNull();
    }
  });

  it("passes real copy and reports the title placeholder first", () => {
    expect(
      describeJobTemplateLeftovers(
        "Tutor needed for MTH 201",
        "Twice weekly, NGN 2,500 per hour, evenings.",
      ),
    ).toBeNull();
    expect(
      describeJobTemplateLeftovers(
        "Tutor needed for [course]",
        "Twice weekly, NGN 2,500 per hour.",
      ),
    ).toContain("[course]");
  });
});
