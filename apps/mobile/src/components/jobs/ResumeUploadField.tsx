import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import {
  JOB_RESUME_ACCEPT_LABEL,
  JOB_RESUME_ALLOWED_MIME_TYPES,
  JOB_RESUME_MAX_BYTES,
  formatJobResumeSize,
  type JobApplicantProfile,
} from "@lantern/shared";
import { uploadJobResume } from "../../services/jobsBoard";
import { AppIcon } from '../ui/AppIcon';

interface Props {
  profile: JobApplicantProfile | null;
  onUploaded: (profile: JobApplicantProfile) => void;
}

export function ResumeUploadField({ profile, onUploaded }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasResume = !!profile?.resumePath;
  const size = formatJobResumeSize(profile?.resumeSizeBytes);

  const pickAndUpload = async () => {
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [...JOB_RESUME_ALLOWED_MIME_TYPES],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;

      setUploading(true);
      const response = await uploadJobResume({
        uri: asset.uri,
        name: asset.name,
        size: asset.size ?? null,
        mimeType: asset.mimeType ?? null,
      });
      onUploaded(response.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resume upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <View>
      <Text className="text-sm font-medium text-lantern-text">Resume</Text>

      {hasResume ? (
        <View className="mt-1.5 flex-row items-center gap-3 rounded-xl border border-lantern-border bg-lantern-background p-3">
          <AppIcon name="document-text" size={28} color="#0f766e" />
          <View className="min-w-0 flex-1">
            <Text
              className="text-sm font-medium text-lantern-text"
              numberOfLines={1}
            >
              {profile?.resumeFilename || "Your resume"}
            </Text>
            <Text className="mt-0.5 text-xs text-lantern-text-tertiary">
              {size ? `${size} · ` : ""}Saved to your profile
            </Text>
          </View>
          <Pressable
            onPress={() => void pickAndUpload()}
            disabled={uploading}
            accessibilityRole="button"
            className="rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2"
          >
            {uploading ? (
              <ActivityIndicator color="#0f766e" size="small" />
            ) : (
              <Text className="text-sm font-medium text-lantern-text">
                Replace
              </Text>
            )}
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => void pickAndUpload()}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel="Upload your resume"
          className="mt-1.5 items-center gap-1 rounded-xl border border-dashed border-lantern-border bg-lantern-background px-4 py-6"
        >
          {uploading ? (
            <ActivityIndicator color="#0f766e" />
          ) : (
            <AppIcon name="document-text" size={26} color="#94a3b8" />
          )}
          <Text className="text-sm font-semibold text-lantern-primary">
            {uploading ? "Uploading…" : "Upload your resume"}
          </Text>
          <Text className="text-xs text-lantern-text-tertiary">
            {JOB_RESUME_ACCEPT_LABEL}, up to{" "}
            {formatJobResumeSize(JOB_RESUME_MAX_BYTES)}
          </Text>
        </Pressable>
      )}

      {hasResume ? (
        <Text className="mt-1.5 text-xs text-lantern-text-tertiary">
          This resume is attached to new applications automatically.
        </Text>
      ) : null}

      {error ? (
        <Text className="mt-1.5 text-xs font-medium text-red-600">{error}</Text>
      ) : null}
    </View>
  );
}

export default ResumeUploadField;
