import React, { useEffect, useState } from 'react';
import type { InstitutionSummary } from '@lantern/shared';
import {
  SCHOOL_CITY_MAX_LENGTH,
  SCHOOL_NAME_MAX_LENGTH,
  isValidSchoolName,
  schoolKindOptions,
  type SchoolKind,
} from '@lantern/shared/academic';
import { Button, Input, Select } from '../ui';
import { createSchool, fetchSchools, updateAcademicProfile } from '../../services/academic';
import { useAuthStore } from '../../stores/authStore';

/**
 * Instructors register any school — primary through university — then save it
 * on their profile. There is no global teacher flag.
 */
export const TeachAffiliationForm: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const currentUser = useAuthStore((s) => s.currentUser);
  const setCurrentUser = useAuthStore((s) => s.setCurrentUser);
  const [kind, setKind] = useState<SchoolKind>('secondary');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<(InstitutionSummary & { city?: string; state?: string })[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<InstitutionSummary | null>(null);
  const [unlisted, setUnlisted] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (picked || unlisted) return;
    if (trimmed.length < 2) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      fetchSchools({ q: trimmed, kind })
        .then((rows) => {
          if (!cancelled) setMatches(rows);
        })
        .catch((err: Error) => {
          if (!cancelled) setError(err.message);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, kind, picked, unlisted]);

  if (!currentUser || currentUser.institutionId) return null;

  const save = async (school: InstitutionSummary) => {
    const user = await updateAcademicProfile(currentUser.id, { institutionId: school.id });
    setCurrentUser(user);
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (picked) {
        await save(picked);
        return;
      }
      if (!isValidSchoolName(name)) {
        throw new Error('Type your school’s name (at least 2 characters)');
      }
      const school = await createSchool({ name: name.trim(), kind, city: city.trim() || undefined });
      await save(school);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your school');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-lantern border border-lantern-border bg-lantern-surface p-4">
      <p className="text-title font-semibold text-lantern-text">Your school</p>
      {!compact ? (
        <p className="text-caption text-lantern-text-secondary">
          Primary, secondary and tertiary schools are all welcome. This is affiliation only — it does not make you an instructor until you create a class.
        </p>
      ) : null}
      <label className="flex flex-col gap-1">
        <span className="text-caption text-lantern-text-secondary">School type</span>
        <Select
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as SchoolKind);
            setPicked(null);
            setMatches([]);
          }}
        >
          {schoolKindOptions().map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>
      {!unlisted ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-caption text-lantern-text-secondary">Search for your school</span>
            <Input
              value={picked ? picked.name : query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPicked(null);
              }}
              placeholder="Start typing the school name"
            />
          </label>
          {searching ? <p className="text-caption text-lantern-text-secondary">Searching…</p> : null}
          {matches.length > 0 && !picked ? (
            <ul className="max-h-40 overflow-y-auto rounded-lg border border-lantern-border">
              {matches.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-body hover:bg-lantern-background-secondary"
                    onClick={() => {
                      setPicked(row);
                      setQuery(row.name);
                    }}
                  >
                    {row.name}
                    {row.city && row.city !== '—' ? (
                      <span className="text-caption text-lantern-text-secondary"> · {row.city}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            className="text-caption text-lantern-primary text-left"
            onClick={() => {
              setUnlisted(true);
              setPicked(null);
              setName(query.trim());
            }}
          >
            My school isn’t listed
          </button>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-caption text-lantern-text-secondary">School name</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="King’s College, Lagos"
              maxLength={SCHOOL_NAME_MAX_LENGTH}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-caption text-lantern-text-secondary">City (optional)</span>
            <Input
              value={city}
              onChange={(event) => setCity(event.target.value)}
              placeholder="Lagos"
              maxLength={SCHOOL_CITY_MAX_LENGTH}
            />
          </label>
          <button type="button" className="text-caption text-lantern-primary text-left" onClick={() => setUnlisted(false)}>
            Search listed schools instead
          </button>
        </>
      )}
      {error ? <p className="text-body text-lantern-error">{error}</p> : null}
      <Button type="submit" disabled={saving || (!picked && !unlisted)}>
        {saving ? 'Saving…' : 'Save school'}
      </Button>
    </form>
  );
};
