import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  JOB_APPLICATION_STATUS_LABELS,
  JOB_EMPLOYER_BULK_STATUSES,
  type JobApplicationStatus,
} from "@lantern/shared";

interface Props {
  selectedCount: number;
  totalCount: number;
  busy?: boolean;
  onClear: () => void;
  onSelectAll: () => void;
  onBulkStatus: (status: JobApplicationStatus) => void | Promise<void>;
  onExportSelected: () => void | Promise<void>;
  onExportAll: () => void | Promise<void>;
}

export function JobBulkActionsBar({
  selectedCount,
  totalCount,
  busy,
  onClear,
  onSelectAll,
  onBulkStatus,
  onExportSelected,
  onExportAll,
}: Props) {
  const [status, setStatus] = useState<JobApplicationStatus>("reviewing");

  return (
    <View className="mb-3 rounded-xl border border-lantern-border bg-lantern-surface p-3">
      <Text className="text-sm text-lantern-text">
        {selectedCount > 0
          ? `${selectedCount} selected`
          : `${totalCount} applicants`}
      </Text>
      <View className="mt-2 flex-row flex-wrap" style={{ gap: 8 }}>
        <Pressable
          disabled={busy || totalCount === 0}
          onPress={onSelectAll}
          accessibilityRole="button"
        >
          <Text className="text-xs font-semibold text-lantern-primary-text">
            Select all
          </Text>
        </Pressable>
        {selectedCount > 0 ? (
          <Pressable
            disabled={busy}
            onPress={onClear}
            accessibilityRole="button"
          >
            <Text className="text-xs font-semibold text-lantern-text-secondary">
              Clear
            </Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mt-2"
      >
        {JOB_EMPLOYER_BULK_STATUSES.map((value) => (
          <Pressable
            key={value}
            disabled={busy}
            onPress={() => setStatus(value)}
            accessibilityRole="button"
            className={`mr-2 rounded-full border px-3 py-1.5 ${
              status === value
                ? "border-lantern-primary bg-lantern-primary-fill"
                : "border-lantern-border"
            }`}
          >
            <Text
              className={`text-xs ${
                status === value
                  ? "font-semibold text-white"
                  : "text-lantern-text"
              }`}
            >
              {JOB_APPLICATION_STATUS_LABELS[value]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View className="mt-2 flex-row flex-wrap" style={{ gap: 8 }}>
        <Pressable
          disabled={busy || selectedCount === 0}
          onPress={() => void onBulkStatus(status)}
          accessibilityRole="button"
          className="rounded-lg bg-lantern-primary-fill px-3 py-2 disabled:opacity-50"
        >
          <Text className="text-sm font-semibold text-white">
            {busy ? "Updating…" : "Move selected"}
          </Text>
        </Pressable>
        <Pressable
          disabled={busy || selectedCount === 0}
          onPress={() => void onExportSelected()}
          accessibilityRole="button"
          className="rounded-lg border border-lantern-border px-3 py-2"
        >
          <Text className="text-sm font-medium text-lantern-text">
            Export selected
          </Text>
        </Pressable>
        <Pressable
          disabled={busy || totalCount === 0}
          onPress={() => void onExportAll()}
          accessibilityRole="button"
          className="rounded-lg border border-lantern-border px-3 py-2"
        >
          <Text className="text-sm font-medium text-lantern-text">
            Export CSV
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export default JobBulkActionsBar;
