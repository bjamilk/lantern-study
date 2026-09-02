import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronRightIcon,
  GlobeAltIcon,
  HashtagIcon,
  LockClosedIcon,
  PlusIcon,
  SpeakerWaveIcon,
} from '@heroicons/react/24/outline';
import {
  COMMUNITY_COPY,
  COMMUNITY_LOUNGE_CHANNEL_NAME,
  buildCommunityChannelRows,
  channelDisplayName,
  channelSubtitle,
  formatCommunityUnread,
  roomSubtitle,
  type CommunityChannel,
  type CommunityChannelRow,
  type CommunityChannels,
  type StudyRoomListItem,
} from '@lantern/shared/network';
import type { Group } from '../../types';
import { LOUNGE_PENDING_ID } from './communityNavigation';

export interface CommunityChannelListProps {
  payload: CommunityChannels;
  groups: Group[];
  /** The channel currently open in the pane — gets `aria-current="page"`. */
  selectedGroupId?: string | null;
  /** Row busy with a join / lounge mint (`LOUNGE_PENDING_ID` for the lounge). */
  pendingId?: string | null;
  onOpenLounge: () => void;
  onOpenChannel: (channel: CommunityChannel) => void;
  onJoinChannel: (channel: CommunityChannel) => void;
  onOpenRoom: (room: StudyRoomListItem) => void;
  onCreateChannel: () => void;
  onStartRoom: () => void;
  onOpenMembers?: () => void;
}

const ROW =
  'w-full flex items-center gap-2 rounded-lantern px-3 py-1 min-h-[44px] md:min-h-[40px] text-left transition-colors hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary disabled:opacity-60';
const ROW_SELECTED = 'bg-lantern-primary-background text-lantern-primary';
const PILL =
  'ml-auto bg-lantern-error text-white text-[10px] font-bold min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded-full shrink-0';

const UnreadPill: React.FC<{ count: number }> = ({ count }) =>
  count > 0 ? (
    <span className={PILL} aria-hidden="true">
      {formatCommunityUnread(count)}
    </span>
  ) : null;

const VisibilityGlyph: React.FC<{ visibility: CommunityChannel['visibility'] }> = ({ visibility }) =>
  visibility === 'community' ? (
    <LockClosedIcon
      className="w-3 h-3 shrink-0 text-lantern-text-tertiary"
      aria-label={COMMUNITY_COPY.membersOnly}
      title={COMMUNITY_COPY.membersOnly}
    />
  ) : (
    <GlobeAltIcon
      className="w-3 h-3 shrink-0 text-lantern-text-tertiary"
      aria-label="Public"
      title="Public"
    />
  );

/**
 * The server's channel list (spec §5.4): one row model from
 * `buildCommunityChannelRows`, rendered in the column at md+ and inline on
 * the community home below md. Order is fixed by shared code:
 * lounge → TEXT CHANNELS → STUDY ROOMS → MEMBERS.
 */
export const CommunityChannelList: React.FC<CommunityChannelListProps> = ({
  payload,
  groups,
  selectedGroupId,
  pendingId,
  onOpenLounge,
  onOpenChannel,
  onJoinChannel,
  onOpenRoom,
  onCreateChannel,
  onStartRoom,
  onOpenMembers,
}) => {
  // "Closes in Xh" ticks once a minute while a room is listed.
  const [now, setNow] = useState(() => Date.now());
  const hasRooms = payload.rooms.length > 0;
  useEffect(() => {
    if (!hasRooms) return undefined;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, [hasRooms, payload]);

  const rows = useMemo(
    () => buildCommunityChannelRows(payload, groups, now),
    [payload, groups, now]
  );

  const renderRow = (row: CommunityChannelRow, index: number): React.ReactNode => {
    switch (row.kind) {
      case 'lounge': {
        const loungeId = row.channel?.id ?? payload.loungeGroupId;
        const selected = !!loungeId && selectedGroupId === loungeId;
        const busy = pendingId === LOUNGE_PENDING_ID;
        const name = channelDisplayName({ isLounge: true, name: COMMUNITY_LOUNGE_CHANNEL_NAME });
        return (
          <li key="lounge">
            <button
              type="button"
              onClick={onOpenLounge}
              disabled={busy}
              aria-current={selected ? 'page' : undefined}
              aria-label={`${name}${row.unread > 0 ? `, ${row.unread} unread` : ''}, ${COMMUNITY_COPY.loungeSubtitle}`}
              className={`${ROW} ${selected ? ROW_SELECTED : ''}`}
            >
              <HashtagIcon className="w-4 h-4 shrink-0 text-lantern-text-tertiary" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm ${row.unread > 0 ? 'font-bold text-lantern-text' : 'font-medium text-lantern-text'}`}>
                  {name.replace(/^# /, '')}
                </span>
                <span className="block truncate text-[11px] text-lantern-text-tertiary">
                  {busy ? 'Opening…' : COMMUNITY_COPY.loungeSubtitle}
                </span>
              </span>
              <UnreadPill count={row.unread} />
            </button>
          </li>
        );
      }
      case 'section':
        return (
          <li key={`section-${row.title}`} className="flex items-center justify-between px-3 pt-4 pb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary">
              {row.title}
            </span>
            {row.action ? (
              <button
                type="button"
                onClick={row.action === 'create-channel' ? onCreateChannel : onStartRoom}
                aria-label={row.action === 'create-channel' ? COMMUNITY_COPY.createChannel : COMMUNITY_COPY.startRoom}
                title={row.action === 'create-channel' ? COMMUNITY_COPY.createChannel : COMMUNITY_COPY.startRoom}
                className="-mr-2 flex h-11 w-11 items-center justify-center rounded-lantern text-lantern-text-tertiary hover:bg-lantern-background-secondary hover:text-lantern-text focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary md:h-8 md:w-8"
              >
                <PlusIcon className="w-4 h-4" aria-hidden="true" />
              </button>
            ) : null}
          </li>
        );
      case 'channel': {
        const { channel } = row;
        const selected = selectedGroupId === channel.id;
        const busy = pendingId === channel.id;
        const name = channelDisplayName(channel);
        const subtitle = busy ? 'Joining…' : channelSubtitle(channel);
        return (
          <li key={channel.id}>
            <button
              type="button"
              onClick={() => (channel.isMember ? onOpenChannel(channel) : onJoinChannel(channel))}
              disabled={busy}
              aria-current={selected ? 'page' : undefined}
              aria-label={`${name}${row.unread > 0 ? `, ${row.unread} unread` : ''}, ${subtitle}`}
              title={subtitle}
              className={`${ROW} ${selected ? ROW_SELECTED : ''} ${channel.isMember ? '' : 'opacity-70'}`}
            >
              <HashtagIcon className="w-4 h-4 shrink-0 text-lantern-text-tertiary" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className={`truncate text-sm ${row.unread > 0 ? 'font-bold text-lantern-text' : 'font-medium text-lantern-text'}`}>
                    {channel.name}
                  </span>
                  <VisibilityGlyph visibility={channel.visibility} />
                </span>
                <span className="block truncate text-[11px] text-lantern-text-tertiary">{subtitle}</span>
              </span>
              <UnreadPill count={row.unread} />
            </button>
          </li>
        );
      }
      case 'room': {
        const { room } = row;
        const subtitle = roomSubtitle(room, now);
        return (
          <li key={room.id}>
            <button
              type="button"
              onClick={() => onOpenRoom(room)}
              aria-label={`${room.joined ? 'Open' : 'Join'} ${room.title}, ${subtitle}`}
              className={ROW}
            >
              <SpeakerWaveIcon className="w-4 h-4 shrink-0 text-lantern-text-tertiary" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-lantern-text">{room.title}</span>
                <span className="block truncate text-[11px] text-lantern-text-tertiary">{subtitle}</span>
              </span>
              <span className={`shrink-0 text-xs font-semibold ${room.joined ? 'text-lantern-text-secondary' : 'text-lantern-primary'}`}>
                {room.joined ? 'Open' : 'Join'}
              </span>
            </button>
          </li>
        );
      }
      case 'empty':
        return (
          <li key={`empty-${index}`} className="px-3 py-2 text-xs text-lantern-text-tertiary">
            {row.text}
          </li>
        );
      case 'members': {
        const label = `${COMMUNITY_COPY.sectionMembers} · ${row.count.toLocaleString()}`;
        return (
          <li key="members" className="pt-3">
            {onOpenMembers ? (
              <button type="button" onClick={onOpenMembers} className={ROW}>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary">{label}</span>
                <ChevronRightIcon className="ml-auto w-4 h-4 shrink-0 text-lantern-text-tertiary" aria-hidden="true" />
              </button>
            ) : (
              <span className="block px-3 text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary">
                {label}
              </span>
            )}
          </li>
        );
      }
      default:
        return null;
    }
  };

  return <ul className="space-y-0.5 px-1 pb-2">{rows.map(renderRow)}</ul>;
};

export default CommunityChannelList;
