import React, { useEffect, useState } from "react";
import {
  JOB_COMPANY_VERIFICATION_LABELS,
  canEditJobCompanyProfile,
  canManageJobCompanyMembers,
  canRemoveJobCompanyMember,
  type JobCompany,
  type JobCompanyMember,
  type JobCompanyMemberRole,
} from "@lantern/shared";
import {
  fetchJobCompanyMembers,
  inviteJobCompanyMember,
  removeJobCompanyMember,
  updateJobCompany,
  uploadJobCompanyLogo,
} from "../../services/jobsBoard";

import { compressImage } from "../../utils/imageCompression";

async function fileToBase64(file: File): Promise<{ base64Data: string; fileName: string }> {
  let prepared = file;
  if (file.type.startsWith("image/")) {
    try {
      const compressed = await compressImage(file, {
        maxWidth: 512,
        maxHeight: 512,
        quality: 0.82,
        outputType: "file",
      });
      if (compressed instanceof File) prepared = compressed;
    } catch {
      // Fall back to original if canvas compression fails.
    }
  }
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1]! : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(prepared);
  });
  return {
    base64Data,
    fileName: prepared.name || file.name || `logo-${Date.now()}.webp`,
  };
}

interface Props {
  company: JobCompany;
  role: JobCompanyMemberRole;
  actorUserId?: string | null;
  onUpdated: (company: JobCompany) => void;
  onOpenPublic: () => void;
}

/** Expandable company editor: about, logo, and recruiter invites. */
export function JobCompanyManageCard({
  company,
  role,
  actorUserId,
  onUpdated,
  onOpenPublic,
}: Props) {
  const canEdit = canEditJobCompanyProfile(role);
  const canManage = canManageJobCompanyMembers(role);
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(company.displayName || "");
  const [tagline, setTagline] = useState(company.tagline || "");
  const [about, setAbout] = useState(company.about || "");
  const [website, setWebsite] = useState(company.website || "");
  const [industry, setIndustry] = useState(company.industry || "");
  const [hqLocation, setHqLocation] = useState(company.hqLocation || "");
  const [inviteUsername, setInviteUsername] = useState("");
  const [members, setMembers] = useState<JobCompanyMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(company.displayName || "");
    setTagline(company.tagline || "");
    setAbout(company.about || "");
    setWebsite(company.website || "");
    setIndustry(company.industry || "");
    setHqLocation(company.hqLocation || "");
  }, [company]);

  useEffect(() => {
    if (!open) return;
    void fetchJobCompanyMembers(company.id)
      .then((res) => setMembers((res.data || []) as JobCompanyMember[]))
      .catch(() => setMembers([]));
  }, [open, company.id]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await updateJobCompany(company.id, {
        displayName,
        tagline,
        about,
        website,
        industry,
        hqLocation,
      });
      onUpdated(res.data as JobCompany);
      setMessage("Company profile saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const onLogo = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload = await fileToBase64(file);
      const res = await uploadJobCompanyLogo(company.id, {
        base64Data: payload.base64Data,
        fileName: payload.fileName,
      });
      onUpdated(res.data as JobCompany);
      setMessage("Logo updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload logo");
    } finally {
      setBusy(false);
    }
  };

  const invite = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await inviteJobCompanyMember(company.id, {
        username: inviteUsername,
      });
      setMembers((prev) => [...prev, res.data as JobCompanyMember]);
      setInviteUsername("");
      setMessage("Recruiter invited.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (userId: string) => {
    setBusy(true);
    setError(null);
    try {
      await removeJobCompanyMember(company.id, userId);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
      setMessage("Teammate removed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove teammate");
    } finally {
      setBusy(false);
    }
  };

  const statusLabel =
    JOB_COMPANY_VERIFICATION_LABELS[
      company.verificationStatus as keyof typeof JOB_COMPANY_VERIFICATION_LABELS
    ] || company.verificationStatus;

  return (
    <li className="rounded-lg border border-lantern-border p-3 space-y-2">
      <div className="flex items-start gap-3">
        {company.logoUrl ? (
          <img
            src={company.logoUrl}
            alt=""
            className="h-10 w-10 rounded-lg border border-lantern-border object-contain bg-white p-1"
          />
        ) : (
          <div
            aria-hidden
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-lantern-primary/10 text-sm font-bold text-lantern-primary"
          >
            {(company.displayName || "?").charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-lantern-text truncate">
            {company.displayName}
          </p>
          <p className="text-xs text-lantern-text-tertiary">
            {statusLabel} · {role}
          </p>
          {company.verificationStatus === "rejected" &&
          company.verificationNote ? (
            <p className="mt-1 text-xs text-red-700">
              Admin note: {company.verificationNote}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onOpenPublic}
            className="rounded-lg border border-lantern-border px-2 py-1 text-xs font-medium text-lantern-text hover:border-lantern-primary/40"
          >
            View page
          </button>
          {canEdit ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="rounded-lg bg-lantern-primary/10 px-2 py-1 text-xs font-semibold text-lantern-primary"
            >
              {open ? "Close" : "Edit"}
            </button>
          ) : null}
        </div>
      </div>

      {open && canEdit ? (
        <div className="border-t border-lantern-border pt-3 space-y-2">
          <input
            className="w-full rounded-lg border border-lantern-border px-3 py-2 text-sm bg-lantern-background"
            placeholder="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-lantern-border px-3 py-2 text-sm bg-lantern-background"
            placeholder="Tagline"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
          />
          <textarea
            className="w-full rounded-lg border border-lantern-border px-3 py-2 text-sm bg-lantern-background min-h-[88px]"
            placeholder="About the company"
            value={about}
            onChange={(e) => setAbout(e.target.value)}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="w-full rounded-lg border border-lantern-border px-3 py-2 text-sm bg-lantern-background"
              placeholder="Website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
            <input
              className="w-full rounded-lg border border-lantern-border px-3 py-2 text-sm bg-lantern-background"
              placeholder="Industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
            />
          </div>
          <input
            className="w-full rounded-lg border border-lantern-border px-3 py-2 text-sm bg-lantern-background"
            placeholder="HQ / city"
            value={hqLocation}
            onChange={(e) => setHqLocation(e.target.value)}
          />
          <label className="block text-xs text-lantern-text-secondary">
            Logo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="mt-1 block w-full text-sm"
              onChange={(e) => void onLogo(e.target.files?.[0] || null)}
            />
          </label>
          <button
            type="button"
            disabled={busy || !displayName.trim()}
            onClick={() => void save()}
            className="rounded-lg bg-lantern-primary text-white px-3 py-2 text-sm font-semibold disabled:opacity-60"
          >
            Save profile
          </button>

          {canManage ? (
            <div className="border-t border-lantern-border pt-3 space-y-2">
              <h3 className="text-sm font-semibold text-lantern-text">Team</h3>
              <ul className="space-y-1">
                {members.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="truncate text-lantern-text">
                      {m.user?.name || m.user?.username || m.userId}
                      <span className="text-lantern-text-tertiary">
                        {" "}
                        · {m.role}
                      </span>
                    </span>
                    {canRemoveJobCompanyMember({
                      actorRole: role,
                      targetRole: m.role,
                      actorUserId: actorUserId || "",
                      targetUserId: m.userId,
                    }) ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void removeMember(m.userId)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-lantern-border px-3 py-2 text-sm bg-lantern-background"
                  placeholder="Invite by username"
                  value={inviteUsername}
                  onChange={(e) => setInviteUsername(e.target.value)}
                />
                <button
                  type="button"
                  disabled={busy || !inviteUsername.trim()}
                  onClick={() => void invite()}
                  className="rounded-lg border border-lantern-border px-3 py-2 text-sm font-semibold disabled:opacity-60"
                >
                  Invite
                </button>
              </div>
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {message ? (
            <p className="text-sm text-emerald-600">{message}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
