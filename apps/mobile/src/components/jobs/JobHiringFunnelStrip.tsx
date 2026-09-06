import React from "react";
import { Text, View } from "react-native";
import {
  JOB_FUNNEL_STAGE_LABELS,
  jobFunnelStageEntries,
  type JobHiringFunnel,
} from "@lantern/shared";

interface Props {
  funnel: JobHiringFunnel;
}

export function JobHiringFunnelStrip({ funnel }: Props) {
  const entries = jobFunnelStageEntries(funnel);
  const max = Math.max(...entries.map(([, value]) => value), 1);

  return (
    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
      {entries.map(([stage, value]) => {
        const fill = Math.max(8, Math.round((value / max) * 100));
        return (
          <View
            key={stage}
            className="min-w-[30%] flex-1 rounded-lg border border-lantern-border bg-lantern-background p-2.5"
          >
            <Text className="text-[11px] font-medium text-lantern-text-secondary">
              {JOB_FUNNEL_STAGE_LABELS[stage]}
            </Text>
            <Text className="mt-0.5 text-lg font-bold text-lantern-text">
              {value}
            </Text>
            <View className="mt-2 h-1 overflow-hidden rounded-full bg-lantern-border">
              <View
                className="h-full rounded-full bg-lantern-primary-fill"
                style={{ width: `${fill}%` }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default JobHiringFunnelStrip;
