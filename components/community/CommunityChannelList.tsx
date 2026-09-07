import React, { useEffect, useMemo, useState } from 'react';
import {
  AcademicCapIcon,
  ArrowRightIcon,
  ChatBubbleLeftRightIcon,
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
  boardDisplayName,
  boardSubtitle,
  buildCommunityChannelRows,
  formatCommunityUnread,
  roomSubtitle,
  studyGroupSubtitle,
  type CommunityChannel,
  type CommunityChannelRow,
  type CommunityChannels,
  type CommunityStudyGroup,
  type StudyRoomListItem,
} from '@lantern/shared/network';
import type { Group } from '../../types';
import { LOUNGE_PENDING_ID } from './communityNavigation';

export interface CommunityChannelListProps {
  payload: CommunityChannels;
  groups: Group[];
  /** The board currently open in the pane — gets `aria-current="page"`. */
  selectedGroupId?: string | null;
  /** Row busy with a join / lounge mint (`LOUNGE_PENDING_ID` for the lounge). */
  pendingId?: string | null;
  onOpenLounge: () => void;
  onOpenBoard: (board: CommunityChannel) => void;
  onJoinBoard: (board: CommunityChannel) => void;
  onOpenStudyGroup: (group: CommunityStudyGroup) => void;
  onOpenRoom: (room: StudyRoomListItem) => void;
  onCreateBoard: () => void;
  onStartStudyGroup: () => void;
  onStartRoom: () => void;
  onOpenMembers?: () => void;
}

const ROW =
  'w-full flex items-center gap-2 rounded-lantern px-3 py-1 min-h-[44px] md:min-h-[40px] text-left transition-colors hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary disabled:opacity-60';
const ROW_SELECTED = 'bg-lantern-primary-background text-lantern-primary';
const PILL =
  'ml-auto bg-lantern-error-strong text-white text-label tracking-normal font-bold min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded-full shrink-0';

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

/** The `# ` prefix is drawn as a glyph, so the label text drops it. */
const plainName = (label: string): string => label.replace(/^# /, '');

/**
 * The server's channel list (spec §5.3): one row model from
 * `buildCommunityChannelRows`, rendered in the column at md+ and inline on the
 * community home below md. Order is fixed by shared code and never sorted,
 * filtered or added to here (§8 parity rule 2):
 * General → BOARDS → STUDY GROUPS → STUDY ROOMS → MEMBERS.
 */
export const CommunityChannelList: React.FC<CommunityChannelListProps> = ({
  payload,
  groups,
  selectedGroupId,
  pendingId,
  onOpenLounge,
  onOpenBoard,
  onJoinBoard,
  onOpenStudyGroup,
  onOpenRoom,
  onCreateBoard,
  onStartStudyGroup,
  onStartRoom,
  onOpenMembers,
}) => {
  // "Closes in Xh" ticks once a minute while a room is listed; the board
  // subtitles ("last post 2h") ride the same tick.
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

  const sectionAction = (action: NonNullable<Extract<CommunityChannelRow, { kind: 'section' }>['action']>) => {
    switch (action) {
      case 'create-board':
        return { label: COMMUNITY_COPY.createBoard, run: onCreateBoard };
      case 'start-study-group':
        return { label: COMMUNITY_COPY.startStudyGroup, run: onStartStudyGroup };
      case 'start-room':
      default:
        return { label: COMMUNITY_COPY.startRoom, run: onStartRoom };
    }
  };

  const renderRow = (row: CommunityChannelRow, index: number): React.ReactNode => {
    switch (row.kind) {
      case 'lounge': {
        const loungeId = row.channel?.id ?? payload.loungeGroupId;
        const selected = !!loungeId && selectedGroupId === loungeId;
        const busy = pendingId === LOUNGE_PENDING_ID;
        // The one live chat: `General`, and deliberately without the `#` the
        // boards carry (founder decision 4).
        const name = boardDisplayName({ isLounge: true, name: COMMUNITY_LOUNGE_CHANNEL_NAME });
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
              <ChatBubbleLeftRightIcon
                className="w-4 h-4 shrink-0 text-lantern-text-tertiary"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm ${row.unread > 0 ? 'font-bold text-lantern-text' : 'font-medium text-lantern-text'}`}>
                  {name}
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
      case 'section': {
        const action = row.action ? sectionAction(row.action) : null;
        return (
          <li key={`section-${row.title}`} className="flex items-center justify-between px-3 pt-4 pb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary">
              {row.title}
            </span>
            {action ? (
              <button
                type="button"
                onClick={action.run}
                aria-label={action.label}
                title={action.label}
                className="-mr-2 flex h-11 w-11 items-center justify-center rounded-lantern text-lantern-text-tertiary hover:bg-lantern-background-secondary hover:text-lantern-text focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary md:h-8 md:w-8"
              >
                <PlusIcon className="w-4 h-4" aria-hidden="true" />
              </button>
            ) : null}
          </li>
        );
      }
      case 'channel': {
        const board = row.channel;
        const selected = selectedGroupId === board.id;
        const busy = pendingId === board.id;
        const name = boardDisplayName(board);
        const subtitle = busy ? 'Joining…' : boardSubtitle(board, now);
        return (
          <li key={board.id}>
            <button
              type="button"
              onClick={() => (board.isMember ? onOpenBoard(board) : onJoinBoard(board))}
              disabled={busy}
              aria-current={selected ? 'page' : undefined}
              aria-label={`${name}${row.unread > 0 ? `, ${row.unread} unread` : ''}, ${subtitle}`}
              title={subtitle}
              className={`${ROW} ${selected ? ROW_SELECTED : ''} ${board.isMember ? '' : 'opacity-70'}`}
            >
              <HashtagIcon className="w-4 h-4 shrink-0 text-lantern-text-tertiary" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className={`truncate text-sm ${row.unread > 0 ? 'font-bold text-lantern-text' : 'font-medium text-lantern-text'}`}>
                    {plainName(name)}
                  </span>
                  <VisibilityGlyph visibility={board.visibility} />
                </span>
                <span className="block truncate text-[11px] text-lantern-text-tertiary">{subtitle}</span>
              </span>
              <UnreadPill count={row.unread} />
            </button>
          </li>
        );
      }
      case 'study-group': {
        const { group } = row;
        const busy = pendingId === group.id;
        const subtitle = busy ? 'Opening…' : studyGroupSubtitle(group);
        return (
          <li key={group.id}>
            <button
              type="button"
              onClick={() => onOpenStudyGroup(group)}
              disabled={busy}
              aria-label={`${group.name}, ${subtitle}`}
              title={subtitle}
              className={`${ROW} ${group.isMember ? '' : 'opacity-70'}`}
            >
              <AcademicCapIcon className="w-4 h-4 shrink-0 text-lantern-text-tertiary" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-lantern-text">{group.name}</span>
                <span className="block truncate text-[11px] text-lantern-text-tertiary">{subtitle}</span>
              </span>
              <ArrowRightIcon
                className="ml-auto w-4 h-4 shrink-0 text-lantern-text-tertiary"
                aria-hidden="true"
              />
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
