import {
  describeJobScamMatches,
  findJobScamMatches,
  textFailsJobScamCheck,
  textHasJobScamFlags,
} from "./scamPlaybook";

describe("job scam playbook", () => {
  it("blocks pay-to-start and BVN requests", () => {
    expect(textFailsJobScamCheck("You must pay to start training")).toBe(true);
    expect(textFailsJobScamCheck("Send your BVN to verify")).toBe(true);
    expect(findJobScamMatches("gift card required").length).toBeGreaterThan(0);
  });

  it("soft-flags pressure copy without blocking", () => {
    expect(textFailsJobScamCheck("WhatsApp me for immediate start")).toBe(
      false,
    );
    expect(textHasJobScamFlags("WhatsApp me for immediate start")).toBe(true);
    expect(
      describeJobScamMatches(
        findJobScamMatches("WhatsApp me for immediate start"),
      ),
    ).toMatch(/risky/i);
  });

  it("allows normal tutoring copy", () => {
    expect(
      textFailsJobScamCheck("Need a CHEM101 tutor, ₦3000/hour, campus library"),
    ).toBe(false);
    expect(
      textHasJobScamFlags("Need a CHEM101 tutor, ₦3000/hour, campus library"),
    ).toBe(false);
  });
});
