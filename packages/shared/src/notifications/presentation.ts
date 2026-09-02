import type { AppNotification } from "../types";

export type NotificationLinkType =
  | "challenge"
  | "offer"
  | "order"
  | "inquiry"
  | "listing"
  | "dm"
  | "group"
  | "group_invite"
  | "note"
  | "note_share"
  | "job"
  | "job_applications"
  | "job_applicants"
  | "generic";

export interface ParsedNotificationLink {
  type: NotificationLinkType;
  id?: string;
  threadId?: string;
}

export type NotificationIconKey =
  | "bell"
  | "currency"
  | "chat"
  | "shopping"
  | "envelope"
  | "flashcards"
  | "test"
  | "game"
  | "briefcase"
  | "order"
  | "megaphone"
  | "heart"
  | "alert";

export interface NotificationMeta {
  iconKey: NotificationIconKey;
  label: string | null;
  /** Tailwind classes for web icon badge */
  webColorClass: string;
  /** Hex color for mobile Ionicons */
  mobileIconColor: string;
  /** Tailwind bg class for mobile icon container */
  mobileBgClass: string;
  /** Hex accent for the row's left border — the colour-coding cue. */
  accentColor: string;
}

export function formatRelativeTime(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (Number.isNaN(seconds)) return "";

  let interval = seconds / 31536000;
  if (interval > 1) return `${Math.floor(interval)}y ago`;
  interval = seconds / 2592000;
  if (interval > 1) return `${Math.floor(interval)}mo ago`;
  interval = seconds / 86400;
  if (interval > 1) return `${Math.floor(interval)}d ago`;
  interval = seconds / 3600;
  if (interval > 1) return `${Math.floor(interval)}h ago`;
  interval = seconds / 60;
  if (interval > 1) return `${Math.floor(interval)}m ago`;
  return "Just now";
}

export function parseNotificationLink(
  link?: string,
  n?: Pick<AppNotification, "type" | "data" | "link">,
): ParsedNotificationLink | null {
  if (link?.startsWith("challenge:")) {
    return { type: "challenge", id: link.replace("challenge:", "") };
  }
  if (n?.type?.startsWith("challenge")) {
    const challengeId =
      (n.data?.challengeId as string) ||
      (typeof n.data?.data === "object"
        ? ((n.data?.data as Record<string, unknown>)?.challengeId as string)
        : undefined) ||
      link?.replace("challenge:", "");
    if (challengeId) return { type: "challenge", id: challengeId };
  }
  if (link?.startsWith("dm:")) {
    const rest = link.slice(3);
    const lastColon = rest.lastIndexOf(":");
    if (lastColon > 0) {
      return {
        type: "dm",
        threadId: rest.slice(0, lastColon),
        id: rest.slice(lastColon + 1),
      };
    }
  }
  if (
    (n?.type === "dm_message" || n?.type === "dm_message_request") &&
    n.data?.senderId
  ) {
    return {
      type: "dm",
      threadId: n.data.threadId as string | undefined,
      id: n.data.senderId as string,
    };
  }
  if (link?.startsWith("/invites/groups/")) {
    const groupId = link.replace("/invites/groups/", "").split(/[?#]/)[0];
    if (groupId) return { type: "group_invite", id: groupId };
  }
  if (n?.type === "group_invite") {
    const groupId =
      (n.data?.groupId as string) ||
      link?.replace("/invites/groups/", "").split(/[?#]/)[0] ||
      link?.replace("/chat/", "").split(/[?#]/)[0];
    if (groupId) return { type: "group_invite", id: groupId };
  }
  if (link?.startsWith("/notes/share/")) {
    const token = link.replace("/notes/share/", "").split(/[?#]/)[0];
    if (token) return { type: "note_share", id: decodeURIComponent(token) };
  }
  if (n?.type === "note_share_invite" || n?.type === "note_share_accepted") {
    const noteId =
      (n.data?.noteId as string) ||
      link?.replace("/notes/", "").split(/[?#]/)[0];
    if (noteId) return { type: "note", id: noteId };
  }
  if (link?.startsWith("/notes/") && !link.startsWith("/notes/share/")) {
    const noteId = link.replace("/notes/", "").split(/[?#]/)[0];
    if (noteId) return { type: "note", id: noteId };
  }
  if (link?.startsWith("/chat/")) {
    const groupId = link.replace("/chat/", "").split(/[?#]/)[0];
    if (groupId) return { type: "group", id: groupId };
  }
  // Jobs board links are plain app paths rather than `marketplace:` tuples.
  if (n?.type === "job_alert" || link?.startsWith("/marketplace/jobs/")) {
    const postingId =
      (n?.data?.postingId as string) ||
      link?.replace("/marketplace/jobs/", "").split(/[?#]/)[0];
    if (postingId) return { type: "job", id: postingId };
  }
  if (
    n?.type === "job_application_status" ||
    n?.type === "job_interview" ||
    n?.type === "job_offer" ||
    link === "/marketplace/applications"
  ) {
    return { type: "job_applications" };
  }
  // Any employer-pipeline link lands on the applicant list for that posting.
  {
    const postingId =
      link?.match(/\/marketplace\/employer\/jobs\/([^/?#]+)/)?.[1] ||
      (n?.type === "job_application" ||
      n?.type === "job_interview_response" ||
      n?.type === "job_offer_response"
        ? (n.data?.postingId as string)
        : undefined);
    if (postingId) return { type: "job_applicants", id: postingId };
  }
  if (
    (n?.type === "group_message" ||
      n?.type === "mention" ||
      n?.type === "reply") &&
    (n.data?.groupId || link)
  ) {
    const groupId =
      (n.data?.groupId as string) ||
      link?.replace("/chat/", "").split(/[?#]/)[0];
    if (groupId) return { type: "group", id: groupId };
  }
  if (!link) return null;
  // The API writes inquiry notifications as a PATH, not a tuple
  // (`/marketplace/inquiries/<id>`); without this branch they parsed as null
  // and a tap on "new question about your listing" did nothing at all.
  {
    const inquiryId = link.match(/^\/marketplace\/inquiries\/([^/?#]+)/)?.[1];
    if (inquiryId) return { type: "inquiry", id: inquiryId };
  }
  const parts = link.split(":");
  if (parts[0] !== "marketplace" || parts.length < 3) return null;
  const subType = parts[1];
  if (
    subType === "offer" ||
    subType === "inquiry" ||
    subType === "listing" ||
    subType === "order"
  ) {
    return { type: subType, id: parts[2] };
  }
  return { type: "generic", id: parts[2] };
}

export function getNotificationMeta(
  link?: string,
  n?: Pick<AppNotification, "type" | "data" | "link">,
): NotificationMeta {
  // Feature families are colour-coded by type FIRST (before link parsing) so a
  // notification with no link still lands in the right colour family:
  // study/fuchsia, tests/blue, games/red, orders+offers/emerald,
  // jobs/teal, messages/sky, alerts/amber.
  const t = n?.type || "";
  if (t.startsWith("flashcard") || t.startsWith("srs") || t === "study_reminder") {
    return {
      iconKey: "flashcards",
      label: "Flashcards due",
      webColorClass: "text-fuchsia-700 bg-fuchsia-50 dark:bg-fuchsia-950/30",
      mobileIconColor: "#c026d3",
      accentColor: "#c026d3",
      mobileBgClass: "bg-fuchsia-50 dark:bg-fuchsia-950/30",
    };
  }
  if (t.startsWith("test") || t.startsWith("exam")) {
    return {
      iconKey: "test",
      label: t.startsWith("exam") ? "Exam" : "Test",
      webColorClass: "text-blue-700 bg-blue-50 dark:bg-blue-950/30",
      mobileIconColor: "#2563eb",
      accentColor: "#2563eb",
      mobileBgClass: "bg-blue-50 dark:bg-blue-950/30",
    };
  }
  if (t.startsWith("challenge") || t.startsWith("game")) {
    const gameLabel =
      t === "challenge_invite"
        ? "Duel invite"
        : t === "challenge_result"
          ? "Duel result"
          : t === "challenge_accepted"
            ? "Duel accepted"
            : t === "challenge_declined"
              ? "Duel declined"
              : t === "challenge_opponent_finished"
                ? "Opponent finished"
                : "Game";
    return {
      iconKey: "game",
      label: gameLabel,
      webColorClass: "text-lantern-error bg-lantern-error/10",
      mobileIconColor: "#dc2626",
      accentColor: "#dc2626",
      mobileBgClass: "bg-red-50 dark:bg-red-950/30",
    };
  }
  if (t === "marketplace_purchase") {
    return {
      iconKey: "order",
      label: "Sale",
      webColorClass: "text-lantern-success bg-lantern-success/10",
      mobileIconColor: "#059669",
      accentColor: "#059669",
      mobileBgClass: "bg-emerald-50 dark:bg-emerald-950/30",
    };
  }
  if (t === "marketplace_inquiry") {
    return {
      iconKey: "chat",
      label: "Inquiry",
      webColorClass: "text-lantern-accent bg-lantern-accent-background",
      mobileIconColor: "#d97706",
      accentColor: "#d97706",
      mobileBgClass: "bg-amber-50 dark:bg-amber-950/30",
    };
  }
  if (t === "marketplace_order_update") {
    return {
      iconKey: "order",
      label: "Order update",
      webColorClass: "text-lantern-success bg-lantern-success/10",
      mobileIconColor: "#059669",
      accentColor: "#059669",
      mobileBgClass: "bg-emerald-50 dark:bg-emerald-950/30",
    };
  }
  if (t === "marketplace_seller_campaign") {
    return {
      iconKey: "megaphone",
      label: "Shop campaign",
      webColorClass: "text-lantern-primary bg-lantern-primary-background",
      mobileIconColor: "#4f46e5",
      accentColor: "#4f46e5",
      mobileBgClass: "bg-lantern-primary-background",
    };
  }
  if (t === "marketplace_favorite_milestone") {
    return {
      iconKey: "heart",
      label: "Favourites",
      webColorClass: "text-pink-700 bg-pink-50 dark:bg-pink-950/30",
      mobileIconColor: "#db2777",
      accentColor: "#db2777",
      mobileBgClass: "bg-pink-50 dark:bg-pink-950/30",
    };
  }
  if (t === "warning") {
    return {
      iconKey: "alert",
      label: "Alert",
      webColorClass: "text-amber-800 bg-amber-50 dark:bg-amber-950/30",
      mobileIconColor: "#b45309",
      accentColor: "#b45309",
      mobileBgClass: "bg-amber-50 dark:bg-amber-950/30",
    };
  }
  const parsed = parseNotificationLink(link, n);
  if (!parsed) {
    return {
      iconKey: "bell",
      label: null,
      webColorClass: "text-lantern-primary bg-lantern-primary-background",
      mobileIconColor: "#4f46e5",
      accentColor: "#4f46e5",
      mobileBgClass: "bg-lantern-primary-background",
    };
  }
  // Interviews are time-sensitive, so they get their own badge rather than
  // being labelled as a generic application update.
  if (
    n?.type === "job_interview" ||
    n?.type === "job_interview_response" ||
    n?.type === "job_interview_reminder"
  ) {
    return {
      iconKey: "bell",
      label:
        n.type === "job_interview_reminder"
          ? "Interview reminder"
          : "Interview",
      webColorClass: "text-violet-600 bg-violet-50 dark:bg-violet-950/30",
      mobileIconColor: "#7c3aed",
      accentColor: "#7c3aed",
      mobileBgClass: "bg-violet-50 dark:bg-violet-950/30",
    };
  }
  // A job offer is the highest-stakes notification in the pipeline, so it gets
  // the money badge rather than reading as another status change.
  if (
    n?.type === "job_offer" ||
    n?.type === "job_offer_response" ||
    n?.type === "job_offer_reminder"
  ) {
    return {
      iconKey: "currency",
      label: n.type === "job_offer_reminder" ? "Offer expiring" : "Job offer",
      webColorClass: "text-lantern-success bg-lantern-success/10",
      mobileIconColor: "#059669",
      accentColor: "#059669",
      mobileBgClass: "bg-emerald-50 dark:bg-emerald-950/30",
    };
  }
  switch (parsed.type) {
    case "challenge":
      return {
        iconKey: "bell",
        label: "Duel",
        webColorClass: "text-lantern-error bg-lantern-error/10",
        mobileIconColor: "#dc2626",
      accentColor: "#dc2626",
        mobileBgClass: "bg-red-50 dark:bg-red-950/30",
      };
    case "offer":
      return {
        iconKey: "currency",
        label: "Offer",
        webColorClass: "text-lantern-success bg-lantern-success/10",
        mobileIconColor: "#059669",
      accentColor: "#059669",
        mobileBgClass: "bg-emerald-50 dark:bg-emerald-950/30",
      };
    case "inquiry":
      return {
        iconKey: "chat",
        label: "Inquiry",
        webColorClass: "text-lantern-accent bg-lantern-accent-background",
        mobileIconColor: "#d97706",
      accentColor: "#d97706",
        mobileBgClass: "bg-amber-50 dark:bg-amber-950/30",
      };
    case "listing":
      return {
        iconKey: "shopping",
        label: "Listing",
        webColorClass:
          "text-lantern-primary-light bg-lantern-primary-background",
        mobileIconColor: "#6366f1",
      accentColor: "#6366f1",
        mobileBgClass:
          "bg-lantern-primary-background dark:bg-lantern-primary-background",
      };
    case "dm":
      if (n?.type === "dm_message_request") {
        return {
          iconKey: "chat",
          label: "Message request",
          webColorClass: "text-amber-700 bg-amber-50 dark:bg-amber-950/30",
          mobileIconColor: "#b45309",
      accentColor: "#b45309",
          mobileBgClass: "bg-amber-50 dark:bg-amber-950/30",
        };
      }
      return {
        iconKey: "chat",
        label: "Message",
        webColorClass: "text-sky-600 bg-sky-50 dark:bg-sky-900/30",
        mobileIconColor: "#0ea5e9",
      accentColor: "#0ea5e9",
        mobileBgClass: "bg-sky-50 dark:bg-sky-950/30",
      };
    case "group_invite":
      return {
        iconKey: "envelope",
        label: "Group invite",
        webColorClass: "text-lantern-primary bg-lantern-primary-background",
        mobileIconColor: "#4f46e5",
      accentColor: "#4f46e5",
        mobileBgClass: "bg-lantern-primary-background",
      };
    case "group":
      if (n?.type === "mention") {
        return {
          iconKey: "chat",
          label: n.data?.mentionedEveryone
            ? "Mentioned everyone"
            : "Mentioned you",
          webColorClass: "text-amber-700 bg-amber-50 dark:bg-amber-950/30",
          mobileIconColor: "#b45309",
      accentColor: "#b45309",
          mobileBgClass: "bg-amber-50 dark:bg-amber-950/30",
        };
      }
      if (n?.type === "reply") {
        return {
          iconKey: "chat",
          label: "Reply",
          webColorClass: "text-violet-700 bg-violet-50 dark:bg-violet-950/30",
          mobileIconColor: "#6d28d9",
      accentColor: "#6d28d9",
          mobileBgClass: "bg-violet-50 dark:bg-violet-950/30",
        };
      }
      return {
        iconKey: "chat",
        label: "Group",
        webColorClass: "text-sky-600 bg-sky-50 dark:bg-sky-900/30",
        mobileIconColor: "#0ea5e9",
      accentColor: "#0ea5e9",
        mobileBgClass: "bg-sky-50 dark:bg-sky-950/30",
      };
    case "job":
      return {
        iconKey: "briefcase",
        label: n?.type === "job_alert" ? "Job alert" : "Job",
        webColorClass: "text-teal-700 bg-teal-50 dark:bg-teal-950/30",
        mobileIconColor: "#0f766e",
      accentColor: "#0f766e",
        mobileBgClass: "bg-teal-50 dark:bg-teal-950/30",
      };
    case "job_applications":
      return {
        iconKey: "briefcase",
        label: "Application",
        webColorClass: "text-teal-700 bg-teal-50 dark:bg-teal-950/30",
        mobileIconColor: "#0f766e",
      accentColor: "#0f766e",
        mobileBgClass: "bg-teal-50 dark:bg-teal-950/30",
      };
    case "job_applicants":
      return {
        iconKey: "briefcase",
        label: "New applicant",
        webColorClass: "text-teal-700 bg-teal-50 dark:bg-teal-950/30",
        mobileIconColor: "#0f766e",
      accentColor: "#0f766e",
        mobileBgClass: "bg-teal-50 dark:bg-teal-950/30",
      };
    case "note":
    case "note_share":
      return {
        iconKey: "envelope",
        label: "Note share",
        webColorClass: "text-cyan-700 bg-cyan-50 dark:bg-cyan-950/30",
        mobileIconColor: "#0891b2",
        accentColor: "#0891b2",
        mobileBgClass: "bg-cyan-50 dark:bg-cyan-950/30",
      };
    default:
      return {
        iconKey: "bell",
        label: null,
        webColorClass: "text-lantern-primary bg-lantern-primary-background",
        mobileIconColor: "#4f46e5",
      accentColor: "#4f46e5",
        mobileBgClass: "bg-lantern-primary-background",
      };
  }
}

export function getNotificationMessage(n: {
  message?: string;
  body?: string;
  title?: string;
}): string {
  return n.message || n.body || n.title || "";
}

export function isNotificationRead(n: {
  read?: boolean;
  is_read?: boolean;
}): boolean {
  return Boolean(n.read ?? n.is_read);
}

export function getNotificationDate(n: {
  date?: string;
  created_at?: string;
}): string {
  return n.date || n.created_at || new Date().toISOString();
}
