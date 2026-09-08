import { describe, expect, it } from 'vitest';

import {
  planAcceptGroupInviteConfirm,
  planCancelSessionConfirm,
  planDeclineGroupInviteConfirm,
  planDeleteGroupConfirm,
  planDeleteListingConfirm,
  planDeleteOfflineBundleConfirm,
  planDeleteSavingsGoalConfirm,
  planDiscardActiveSessionConfirm,
  planDiscardSavedSessionConfirm,
  planResetSettingsConfirm,
  planRevokeInvitationConfirm,
  planStartDuelConfirm,
  planUnblockUserConfirm,
  planWithdrawApplicationConfirm,
  type ConfirmCopy,
} from './destructiveConfirm';

// The truly destructive/irreversible actions. Reversible ones (unblock, delete
// download, revoke invite) are plain confirms and tested separately below.
const destructivePlanners: Array<{ name: string; copy: ConfirmCopy; target: string }> = [
  {
    name: 'deleteSavingsGoal',
    copy: planDeleteSavingsGoalConfirm({ name: 'New Laptop', currentAmount: 25000 }),
    target: 'New Laptop',
  },
  {
    name: 'deleteListing',
    copy: planDeleteListingConfirm({ title: 'CHM101 Textbook' }),
    target: 'CHM101 Textbook',
  },
  {
    name: 'withdrawApplication',
    copy: planWithdrawApplicationConfirm({ title: 'Campus Ambassador' }),
    target: 'Campus Ambassador',
  },
  {
    name: 'deleteGroup',
    copy: planDeleteGroupConfirm({ name: 'Study Squad' }),
    target: 'Study Squad',
  },
  {
    name: 'discardActiveSession',
    copy: planDiscardActiveSessionConfirm(),
    target: 'session',
  },
  {
    name: 'cancelSession',
    copy: planCancelSessionConfirm(),
    target: 'progress',
  },
  {
    name: 'discardSavedSession',
    copy: planDiscardSavedSessionConfirm(),
    target: 'session',
  },
  {
    name: 'resetSettings',
    copy: planResetSettingsConfirm(),
    target: 'settings',
  },
];

// Reversible actions: still confirmed in-app, but styled as a plain (non-danger)
// confirm. Flipping any planner's `danger` to true fails here.
const reversiblePlanners: Array<{ name: string; copy: ConfirmCopy; target: string }> = [
  {
    name: 'unblockUser',
    copy: planUnblockUserConfirm({ name: 'Ada' }),
    target: 'Ada',
  },
  {
    name: 'deleteOfflineBundle',
    copy: planDeleteOfflineBundleConfirm({ name: 'BIO101 Bundle' }),
    target: 'BIO101 Bundle',
  },
  {
    name: 'revokeInvitation',
    copy: planRevokeInvitationConfirm({ invitee: 'ada@school.edu' }),
    target: 'ada@school.edu',
  },
];

describe('destructive confirm rule', () => {
  // This is the rule: every destructive action is styled danger. Flipping any
  // planner's `danger` to false (or dropping it) fails here.
  it.each(destructivePlanners)('$name is a danger confirm', ({ copy }) => {
    expect(copy.danger).toBe(true);
  });

  it.each(destructivePlanners)('$name names the specific target', ({ copy, target }) => {
    expect(copy.message).toContain(target);
  });

  it.each(destructivePlanners)('$name warns the action cannot be undone', ({ copy }) => {
    expect(copy.message.toLowerCase()).toContain('cannot be undone');
  });

  it.each(destructivePlanners)('$name has both confirm and cancel labels', ({ copy }) => {
    expect(copy.confirmLabel.trim().length).toBeGreaterThan(0);
    expect(copy.cancelLabel.trim().length).toBeGreaterThan(0);
  });
});

describe('reversible (plain) confirm rule', () => {
  // The rule: a reversible action confirms in-app but is NOT styled danger.
  // Marking any of these `danger: true` fails here.
  it.each(reversiblePlanners)('$name is a plain confirm, not danger', ({ copy }) => {
    expect(copy.danger).toBe(false);
  });

  it.each(reversiblePlanners)('$name names the specific target', ({ copy, target }) => {
    expect(copy.message).toContain(target);
  });

  it.each(reversiblePlanners)('$name has both confirm and cancel labels', ({ copy }) => {
    expect(copy.confirmLabel.trim().length).toBeGreaterThan(0);
    expect(copy.cancelLabel.trim().length).toBeGreaterThan(0);
  });
});

describe('planDeleteGroupConfirm', () => {
  it('warns that sub-groups go too', () => {
    expect(planDeleteGroupConfirm({ name: 'Study Squad' }).message).toContain('sub-groups');
  });

  it('reassures that past scores stay in history', () => {
    expect(planDeleteGroupConfirm({ name: 'Study Squad' }).message.toLowerCase()).toContain('history');
  });

  it('uses a generic noun when the group has no name', () => {
    expect(planDeleteGroupConfirm({ name: '' }).message).toContain('this group');
  });
});

describe('planDeleteOfflineBundleConfirm', () => {
  it('tells the user they can download it again', () => {
    expect(planDeleteOfflineBundleConfirm({ name: 'BIO101 Bundle' }).message.toLowerCase())
      .toContain('download it again');
  });

  it('uses a generic noun when the bundle has no name', () => {
    expect(planDeleteOfflineBundleConfirm({ name: '' }).message).toContain('this download');
  });
});

describe('planRevokeInvitationConfirm', () => {
  it('says the person can be invited again', () => {
    expect(planRevokeInvitationConfirm({ invitee: 'ada@school.edu' }).message.toLowerCase())
      .toContain('invite them again');
  });

  it('falls back to a neutral noun when the invitee is missing', () => {
    expect(planRevokeInvitationConfirm({ invitee: '' }).message).toContain('this person');
  });
});

describe('session confirms', () => {
  it('cancelSession warns progress will be lost', () => {
    expect(planCancelSessionConfirm().message.toLowerCase()).toContain('progress will be lost');
  });

  it('discardActiveSession warns progress is not recorded', () => {
    expect(planDiscardActiveSessionConfirm().message.toLowerCase()).toContain('not be recorded');
  });

  it('discardSavedSession warns progress is not recorded', () => {
    expect(planDiscardSavedSessionConfirm().message.toLowerCase()).toContain('not be recorded');
  });
});

describe('planResetSettingsConfirm', () => {
  it('reassures that study data is not affected', () => {
    expect(planResetSettingsConfirm().message.toLowerCase()).toContain('study data will not be affected');
  });
});

describe('planDeleteSavingsGoalConfirm', () => {
  it('tells the user the saved money returns to the wallet', () => {
    const copy = planDeleteSavingsGoalConfirm({ name: 'New Laptop', currentAmount: 25000 });
    expect(copy.message).toContain('₦25,000');
    expect(copy.message).toContain('wallet');
  });

  it('omits the wallet sentence when nothing was saved', () => {
    const copy = planDeleteSavingsGoalConfirm({ name: 'New Laptop', currentAmount: 0 });
    expect(copy.message).not.toContain('wallet');
  });

  it('uses a generic noun when the goal has no name', () => {
    const copy = planDeleteSavingsGoalConfirm({ name: '', currentAmount: 0 });
    expect(copy.message).toContain('this savings goal');
  });
});

describe('planWithdrawApplicationConfirm', () => {
  it('warns re-applying is blocked', () => {
    const copy = planWithdrawApplicationConfirm({ title: 'Campus Ambassador' });
    expect(copy.message.toLowerCase()).toContain('re-apply');
  });
});

describe('planUnblockUserConfirm', () => {
  it('is a plain confirm, not danger (unblocking is reversible)', () => {
    expect(planUnblockUserConfirm({ name: 'Ada' }).danger).toBe(false);
  });

  it('names the person being unblocked', () => {
    expect(planUnblockUserConfirm({ name: 'Ada' }).message).toContain('Ada');
  });

  it('falls back to a neutral noun when the name is missing', () => {
    expect(planUnblockUserConfirm({ name: '' }).message).toContain('this person');
  });
});

describe('group invite confirms', () => {
  // The rule that distinguishes these two: declining CONSUMES the invite on the
  // server (it cannot be reused), so it is destructive; accepting merely joins a
  // group you can later leave, so it is plain. Flip either `danger` and one of
  // these fails.
  it('accepting an invite is a plain confirm (joining is reversible)', () => {
    expect(planAcceptGroupInviteConfirm().danger).toBe(false);
  });

  it('declining an invite is a danger confirm (the invite is destroyed)', () => {
    expect(planDeclineGroupInviteConfirm().danger).toBe(true);
  });

  it('the decline prompt warns the invite cannot be used later', () => {
    expect(planDeclineGroupInviteConfirm().message.toLowerCase()).toContain('not be able to use it to join later');
  });

  it('both invite prompts have confirm and cancel labels', () => {
    for (const copy of [planAcceptGroupInviteConfirm(), planDeclineGroupInviteConfirm()]) {
      expect(copy.confirmLabel.trim().length).toBeGreaterThan(0);
      expect(copy.cancelLabel.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('planStartDuelConfirm', () => {
  it('is a plain confirm, not danger (nothing is destroyed)', () => {
    expect(planStartDuelConfirm({ opponentName: 'Ada' }).danger).toBe(false);
  });

  it('names the opponent who accepted', () => {
    expect(planStartDuelConfirm({ opponentName: 'Ada' }).message).toContain('Ada');
  });

  it('falls back to a neutral noun when the opponent name is missing', () => {
    expect(planStartDuelConfirm({ opponentName: '' }).message).toContain('Your opponent');
  });
});
