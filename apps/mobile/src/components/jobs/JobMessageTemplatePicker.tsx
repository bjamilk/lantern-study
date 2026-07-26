import React from "react";
import { Pressable, ScrollView, Text } from "react-native";
import {
  filterJobMessageTemplates,
  type JobMessageTemplateKind,
} from "@lantern/shared";

interface Props {
  kind: JobMessageTemplateKind;
  onSelect: (body: string) => void;
  disabled?: boolean;
}

export function JobMessageTemplatePicker({ kind, onSelect, disabled }: Props) {
  const templates = filterJobMessageTemplates(kind);
  if (!templates.length) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="mt-1.5"
    >
      {templates.map((template) => (
        <Pressable
          key={template.id}
          disabled={disabled}
          onPress={() => onSelect(template.body)}
          accessibilityRole="button"
          className="mr-2 rounded-full border border-lantern-border bg-lantern-background px-2.5 py-1"
        >
          <Text className="text-[11px] font-medium text-lantern-text-secondary">
            {template.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export default JobMessageTemplatePicker;
