import React from "react";
import { AppNotification } from "../types";
import { AppIcon } from "./ui/AppIcon";
import { Button, NotificationRow } from "./ui";
import Modal from "./ui/Modal";
import {
  parseNotificationLink,
  getNotificationMessage,
  isNotificationRead,
  getNotificationDate,
} from "@lantern/shared";
import AcademicFeedPanel from "./AcademicFeedPanel";

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  onMarkAsRead?: (notificationId: string) => void;
  onMarkAllAsRead: () => void;
  onNavigate?: (screen: string, params?: any) => void;
}

const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen,
  onClose,
  notifications,
  onMarkAsRead,
  onMarkAllAsRead,
  onNavigate,
}) => {
  const sortedNotifications = [...notifications].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  const handleNotificationClick = (n: AppNotification) => {
    if (!n.read && onMarkAsRead) {
      onMarkAsRead(n.id);
    }
    if (
      onNavigate &&
      (n.link ||
        n.type?.startsWith("challenge") ||
        n.type === "dm_message" ||
        n.type === "dm_message_request" ||
        n.type === "group_invite" ||
        n.type === "group_message" ||
        n.type === "mention" ||
        n.type === "reply")
    ) {
      const parsed = parseNotificationLink(n.link, n);
      if (parsed) {
        if (parsed.type === "offer" || parsed.type === "inquiry") {
          onNavigate("MarketplaceInquiries");
        } else if (parsed.type === "listing" && parsed.id) {
          onNavigate("MarketplaceListingDetail", { listingId: parsed.id });
        } else if (parsed.type === "challenge" && parsed.id) {
          onNavigate("Challenges");
          onNavigate("PlayChallenge", { challengeId: parsed.id });
        } else if (parsed.type === "dm" && parsed.id) {
          onNavigate("DirectMessages", {
            userId: parsed.id,
            threadId: parsed.threadId,
          });
        } else if (parsed.type === "group_invite" && parsed.id) {
          onNavigate("GroupInvite", { groupId: parsed.id });
        } else if (parsed.type === "group" && parsed.id) {
          onNavigate("GroupChat", { groupId: parsed.id });
        } else if (parsed.type === "job" && parsed.id) {
          onNavigate("MarketplaceJobDetail", { jobId: parsed.id });
        } else if (parsed.type === "job_applications") {
          onNavigate("MyJobApplications");
        } else if (parsed.type === "job_applicants" && parsed.id) {
          onNavigate("JobEmployerPipeline", { jobId: parsed.id });
        }
        onClose();
      }
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="notification-modal-title"
      maxWidthClass="max-w-lg"
      panelClassName="!p-0 h-[70vh] flex flex-col overflow-hidden"
    >
      <div className="flex justify-between items-center p-4 border-b border-lantern-border flex-shrink-0">
        <h2
          id="notification-modal-title"
          className="text-xl font-semibold text-lantern-text flex items-center gap-2"
        >
          <AppIcon name="notifications" size={24} className="text-lantern-primary" />
          Notifications
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-text-tertiary hover:text-lantern-text rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
          aria-label="Close notifications"
        >
          <AppIcon name="close" size={24} />
        </button>
      </div>

      <div className="flex justify-end items-center px-4 py-2 border-b border-lantern-border flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={onMarkAllAsRead}
          className="gap-1 min-h-[44px]"
        >
          <AppIcon name="mail-open" size={16} />
          Mark all as read
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto pb-safe bg-lantern-surface">
        {isOpen && (
          <AcademicFeedPanel
            limit={6}
            className="rounded-none border-0 border-b border-lantern-border bg-lantern-surface p-4"
            onNavigate={(screen, params) => {
              onNavigate?.(screen, params);
              onClose();
            }}
          />
        )}
        {sortedNotifications.length > 0 ? (
          <ul className="divide-y divide-lantern-border">
            {sortedNotifications.map((n) => (
              <li key={n.id}>
                <NotificationRow
                  message={getNotificationMessage(n)}
                  date={getNotificationDate(n)}
                  read={isNotificationRead(n)}
                  link={n.link}
                  type={n.type}
                  data={n.data}
                  onPress={() => handleNotificationClick(n)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center py-16 px-6">
            <div className="w-14 h-14 mx-auto rounded-full bg-lantern-primary-background flex items-center justify-center">
              <AppIcon name="notifications" size={28} className="text-lantern-primary" />
            </div>
            <p className="mt-4 text-sm font-medium text-lantern-text">
              No notifications yet
            </p>
            <p className="mt-1 text-xs text-lantern-text-secondary">
              You&apos;re all caught up — we&apos;ll let you know when something
              needs your attention.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default NotificationModal;
