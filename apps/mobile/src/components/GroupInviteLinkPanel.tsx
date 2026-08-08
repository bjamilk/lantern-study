// ===========================================
// Lantern Study Mobile - Group Invite Link Panel
// ===========================================
// Shared by AddMembersModal and GroupInfoModal so the link, the copy/share
// affordances and the "no link yet" state stay identical in both places.

import React, { useCallback, useState } from 'react';
import { Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { buildGroupInviteLink } from '@lantern/shared';
import { useTheme } from '../theme';

interface GroupInviteLinkPanelProps {
  groupName: string;
  /**
   * The group's server-side invite token. When absent the panel renders an
   * explanatory empty state rather than a link — a link built from the group id
   * looks valid and silently fails for whoever opens it.
   */
  inviteId?: string;
}

export function GroupInviteLinkPanel({ groupName, inviteId }: GroupInviteLinkPanelProps) {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);
  const inviteLink = inviteId ? buildGroupInviteLink(inviteId) : null;

  const handleCopyLink = useCallback(async () => {
    if (!inviteLink) return;
    await Clipboard.setStringAsync(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [inviteLink]);

  const handleShareLink = useCallback(async () => {
    if (!inviteLink) return;
    try {
      await Share.share({
        message: `Join my study group "${groupName}" on Lantern Study!\n\n${inviteLink}`,
      });
    } catch {
      // The user dismissing the share sheet is not an error.
    }
  }, [inviteLink, groupName]);

  return (
    <View style={[styles.section, { backgroundColor: colors.background }]}>
      <View style={styles.sectionHeader}>
        <Ionicons name="link" size={22} color={colors.primary} />
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Share Invite Link</Text>
      </View>
      <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
        {inviteLink
          ? 'Anyone with this link can join the group'
          : 'This group has no invite link yet. Add members by username instead.'}
      </Text>

      {inviteLink ? (
        <>
          <View
            style={[
              styles.linkContainer,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.linkText, { color: colors.primary }]} numberOfLines={1}>
              {inviteLink}
            </Text>
            <TouchableOpacity
              style={[
                styles.copyButton,
                { backgroundColor: copied ? colors.success : colors.primary },
              ]}
              onPress={() => void handleCopyLink()}
              accessibilityRole="button"
              accessibilityLabel={copied ? 'Invite link copied' : 'Copy invite link'}
            >
              <Ionicons name={copied ? 'checkmark' : 'copy'} size={18} color="#ffffff" />
            </TouchableOpacity>
          </View>

          <View style={styles.shareButtons}>
            <TouchableOpacity
              style={[styles.shareButton, { backgroundColor: colors.primary }]}
              onPress={() => void handleShareLink()}
              accessibilityRole="button"
              accessibilityLabel={`Share invite link for ${groupName}`}
            >
              <Ionicons name="share-social" size={20} color="#ffffff" />
              <Text style={styles.shareButtonText}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.shareButton, { backgroundColor: colors.primary }]}
              onPress={() => void handleCopyLink()}
              accessibilityRole="button"
              accessibilityLabel={copied ? 'Invite link copied' : 'Copy invite link'}
            >
              <Ionicons name="copy" size={20} color="#ffffff" />
              <Text style={styles.shareButtonText}>{copied ? 'Copied!' : 'Copy Link'}</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  sectionDescription: {
    fontSize: 13,
    marginBottom: 12,
  },
  linkContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
    marginBottom: 12,
  },
  linkText: {
    flex: 1,
    fontSize: 13,
  },
  copyButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  shareButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
  },
  shareButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default GroupInviteLinkPanel;
