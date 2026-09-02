import React, { useEffect, useState } from 'react';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import { COMMUNITY_COPY, resolveGroupDiscovery, type MyCommunity } from '@lantern/shared/network';
import { fetchMyCommunities } from '../../services/supabase';

export type GroupDiscoveryValue = {
  visibility: 'private' | 'community' | 'public';
  communityId: string | null;
};

interface GroupDiscoverabilityFieldsProps {
  value: GroupDiscoveryValue;
  onChange: (next: GroupDiscoveryValue) => void;
  disabled?: boolean;
  /**
   * A channel created from inside its community: the listing is fixed to that
   * community, shown as one read-only line, and `onChange` is never called.
   */
  lockedCommunity?: { id: string; name: string };
}

/**
 * Owner control that actually puts a group on Discover. Without this, the
 * Groups tab can only ever be empty because create/update never set visibility.
 */
export const GroupDiscoverabilityFields: React.FC<GroupDiscoverabilityFieldsProps> = ({
  value,
  onChange,
  disabled,
  lockedCommunity,
}) => {
  const [mine, setMine] = useState<MyCommunity[]>([]);
  const locked = !!lockedCommunity;

  useEffect(() => {
    if (locked) return;
    void fetchMyCommunities()
      .then(setMine)
      .catch(() => setMine([]));
  }, [locked]);

  if (lockedCommunity) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-lantern-text">Discover</p>
        <p className="flex items-start gap-1.5 text-xs text-lantern-text-secondary">
          <LockClosedIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{COMMUNITY_COPY.listedIn(lockedCommunity.name)}</span>
        </p>
      </div>
    );
  }

  const listed = value.visibility !== 'private';
  const setListed = (on: boolean) => {
    if (!on) {
      onChange({ visibility: 'private', communityId: null });
      return;
    }
    onChange(resolveGroupDiscovery({ visibility: 'public', communityId: value.communityId }));
  };

  const setScope = (visibility: 'public' | 'community', communityId: string | null) => {
    onChange(resolveGroupDiscovery({ visibility, communityId }));
  };

  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="text-sm font-medium text-lantern-text">Discover</legend>
      <label className="flex items-start gap-2 text-sm text-lantern-text">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={listed}
          onChange={(event) => setListed(event.target.checked)}
        />
        <span>
          Show this group on Discover
          <span className="mt-0.5 block text-xs text-lantern-text-secondary">
            Off by default. People can join from Communities or Groups without an invite link.
          </span>
        </span>
      </label>
      {listed ? (
        <div className="ml-6 space-y-2">
          <label className="flex items-center gap-2 text-sm text-lantern-text">
            <input
              type="radio"
              name="group-discover-scope"
              checked={value.visibility === 'public'}
              onChange={() => setScope('public', value.communityId)}
            />
            Anyone on Discover
          </label>
          <label className="flex items-center gap-2 text-sm text-lantern-text">
            <input
              type="radio"
              name="group-discover-scope"
              checked={value.visibility === 'community'}
              onChange={() =>
                setScope('community', value.communityId || mine[0]?.id || null)
              }
            />
            People in one of my communities
          </label>
          {value.visibility === 'community' ? (
            mine.length === 0 ? (
              <p className="text-xs text-lantern-text-secondary">
                Join or start a community on Discover first.
              </p>
            ) : (
              <select
                value={value.communityId || ''}
                onChange={(event) => setScope('community', event.target.value || null)}
                className="w-full rounded-md border border-lantern-border bg-lantern-surface px-2 py-1.5 text-sm text-lantern-text"
                aria-label="Community for this group"
              >
                <option value="">Choose a community</option>
                {mine.map((community) => (
                  <option key={community.id} value={community.id}>
                    {community.name}
                  </option>
                ))}
              </select>
            )
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
};

export default GroupDiscoverabilityFields;
