import React from 'react';
import { AppIcon } from './ui/AppIcon';
import { LEGAL_PATHS, SUPPORT_EMAIL, buildSupportMailtoUrl } from '@lantern/shared';
import Modal from './ui/Modal';
import { Button } from './ui';
import { useAccountSuspensionStore } from '../services/accountSuspension';
import { formatSuspensionDate } from '../utils/moderationForms';

/**
 * Shown when the API answered 403 ACCOUNT_SUSPENDED (see
 * services/accountSuspension.ts). First as a blocking modal, then — once
 * acknowledged — as a persistent banner in the app shell (same styling as
 * AccountPausedBanner). The session is NOT ended: the user can still read what
 * is cached and contact support; writes keep failing until the date passes.
 */
export const AccountSuspendedNotice: React.FC<{ variant: 'modal' | 'banner' }> = ({ variant }) => {
  const suspended = useAccountSuspensionStore((s) => s.suspended);
  const suspendedUntil = useAccountSuspensionStore((s) => s.suspendedUntil);
  const message = useAccountSuspensionStore((s) => s.message);
  const acknowledged = useAccountSuspensionStore((s) => s.acknowledged);
  const acknowledge = useAccountSuspensionStore((s) => s.acknowledge);

  if (!suspended) return null;

  const untilLabel = formatSuspensionDate(suspendedUntil);
  const mailto = buildSupportMailtoUrl({
    subject: 'Account suspension appeal',
    body: untilLabel ? `My account is suspended until ${untilLabel}. ` : undefined,
  });
  const headline = untilLabel ? `Your account is suspended until ${untilLabel}` : 'Your account is suspended';
  const body =
    'While suspended you cannot post, sell, message or publish. Your data and purchases are safe and ' +
    'your account reopens automatically on that date. If you think this is a mistake, write to ' +
    `${SUPPORT_EMAIL} and we will review it.`;

  if (variant === 'modal') {
    if (acknowledged) return null;
    return (
      <Modal
        isOpen
        onClose={acknowledge}
        ariaLabelledBy="account-suspended-title"
        ariaDescribedBy="account-suspended-body"
        maxWidthClass="max-w-md"
        closeOnBackdrop={false}
        panelClassName="!p-0 overflow-hidden rounded-xl"
      >
        <div className="w-full">
          <div className="flex items-center gap-2 p-5 border-b border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/20">
            <AppIcon name="ban" size={24} className="text-amber-600 shrink-0" aria-hidden />
            <h3 id="account-suspended-title" className="text-lg font-bold text-amber-950 dark:text-amber-100">
              {headline}
            </h3>
          </div>
          <div id="account-suspended-body" className="p-5 space-y-3 text-sm text-lantern-text-secondary">
            {message ? <p className="font-medium text-lantern-text">{message}</p> : null}
            <p>{body}</p>
            <p className="text-xs text-lantern-text-tertiary">
              Suspensions follow our{' '}
              <a
                href={LEGAL_PATHS.prohibited}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-lantern-primary"
              >
                Prohibited Content &amp; Academic Integrity Policy
              </a>
              .
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2 p-5 border-t border-lantern-border">
            <a
              href={mailto}
              className="inline-flex items-center px-4 py-2 border border-lantern-border text-lantern-text rounded-lg hover:bg-lantern-background font-semibold text-sm"
            >
              Contact support
            </a>
            <Button variant="primary" size="sm" onClick={acknowledge}>
              Understood
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // Banner variant: persistent reminder once the modal was dismissed.
  if (!acknowledged) return null;
  return (
    <div
      role="status"
      className="mx-4 mt-4 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20 p-4 flex flex-col sm:flex-row sm:items-center gap-3"
    >
      <div className="flex gap-3 flex-1">
        <AppIcon name="warning" size={24} className="text-amber-600 shrink-0" aria-hidden />
        <div className="text-sm text-amber-950 dark:text-amber-100">
          <p className="font-semibold">{headline}</p>
          <p className="mt-1 text-amber-900/90 dark:text-amber-200/90">{body}</p>
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <a
          href={mailto}
          className="inline-flex items-center px-3 py-1.5 rounded-lg border border-amber-400/60 text-amber-950 dark:text-amber-100 text-sm font-semibold hover:bg-amber-100/60 dark:hover:bg-amber-900/40"
        >
          Contact support
        </a>
      </div>
    </div>
  );
};

export default AccountSuspendedNotice;
