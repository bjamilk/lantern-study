import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  JOBS_COMPLIANCE_BANNER,
  JOB_EMPLOYMENT_TYPES,
  JOB_EMPLOYMENT_TYPE_LABELS,
  describeJobSearchFilters,
  formatJobCompensation,
  formatJobEngagementDuration,
  formatJobLocation,
  formatJobPostedDate,
  isEmptyJobSearchFilters,
  suggestJobSavedSearchName,
  type JobCompensationKind,
  type JobEmploymentType,
  type JobPosting,
  type JobSavedSearch,
  type JobSearchFilters,
  type JobSearchSort,
} from "@lantern/shared";
import { Card, ScreenHeader } from "../../components/ui";
import { Screen } from "../../components/layout";
import {
  fetchJobSavedSearchMatches,
  createJobSavedSearch,
  deleteJobSavedSearch,
  fetchJobPostings,
  fetchJobSavedSearches,
  fetchSavedJobPostings,
  setJobPostingSaved,
  updateJobSavedSearch,
} from "../../services/jobsBoard";
import type { JobsStackParamList } from "../../navigation/types";
import { useTabBarClearance } from '../../components/layout/BottomTabBar';

/** Employment types promoted to one-tap chips; the panel still exposes all 8. */
const QUICK_TYPE_CHIPS: JobEmploymentType[] = [
  "full_time",
  "part_time",
  "internship",
];

const LOCATION_OPTIONS = [
  { id: "", label: "Any location" },
  { id: "remote", label: "Remote" },
  { id: "onsite", label: "On-site / hybrid" },
] as const;

const COMPENSATION_OPTIONS = [
  { id: "", label: "Any pay" },
  { id: "paid", label: "Paid" },
  { id: "discuss", label: "Pay discussed" },
  { id: "unpaid", label: "Unpaid" },
] as const;

const SORT_OPTIONS = [
  { id: "trending", label: "Trending" },
  { id: "newest", label: "Newest" },
  { id: "closing", label: "Closing soon" },
] as const;

type LocationType = "" | "remote" | "onsite";

/** Solid pill used for the quick-filter row. */
function FilterChip({
  label,
  active,
  onPress,
  badge,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={`flex-row items-center gap-1 rounded-full border px-4 py-2 ${
        active
          ? "border-lantern-primary bg-lantern-primary"
          : "border-lantern-border bg-lantern-surface"
      }`}
    >
      <Text
        className={`text-sm font-medium ${
          active ? "text-white" : "text-lantern-text-secondary"
        }`}
      >
        {label}
      </Text>
      {badge && badge > 0 ? (
        <View
          className={`ml-0.5 rounded-full px-1.5 ${active ? "bg-white/25" : "bg-lantern-primary"}`}
        >
          <Text className="text-[10px] font-bold text-white">{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Outline pill used inside the expanded filter panel. */
function SelectPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={`rounded-full border px-3 py-1.5 ${
        active
          ? "border-lantern-primary bg-lantern-primary/10"
          : "border-lantern-border bg-lantern-background"
      }`}
    >
      <Text
        className={`text-xs font-medium ${
          active ? "text-lantern-primary" : "text-lantern-text-secondary"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function formatJobDeadline(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const daysLeft = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  if (daysLeft < 0) return null;
  if (daysLeft === 0) return "Closes today";
  if (daysLeft <= 7) return `Closes in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
  return `Apply by ${date.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

export function JobsHomeScreen() {
  // Scroll content must clear the absolutely-positioned bottom tab bar.
  const tabBarClearance = useTabBarClearance(16);
  const navigation =
    useNavigation<NativeStackNavigationProp<JobsStackParamList>>();
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"all" | "saved">("all");
  // Advanced filters, mirroring the web board's full control set.
  const [employmentType, setEmploymentType] = useState<JobEmploymentType | "">("");
  const [locationType, setLocationType] = useState<LocationType>("");
  const [compensationKind, setCompensationKind] = useState<JobCompensationKind | "">("");
  // `minPay` is the applied value; `minPayDraft` holds keystrokes so a numeric
  // entry does not fire one list request per digit.
  const [minPay, setMinPay] = useState("");
  const [minPayDraft, setMinPayDraft] = useState("");
  const [sort, setSort] = useState<JobSearchSort>("trending");
  const [companyOnly, setCompanyOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedSearches, setSavedSearches] = useState<JobSavedSearch[]>([]);
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);
  const [savingSearch, setSavingSearch] = useState(false);
  const [savedSearchMatches, setSavedSearchMatches] = useState<Record<string, number>>({});
  const limit = 12;

  const activeFilters = useMemo<JobSearchFilters>(() => {
    const saved = savedSearches.find((item) => item.id === activeSavedId);
    if (saved) return saved.filters;
    // Default sort stays 'trending' to match the web board exactly; drift here
    // has caused saved-search bugs before.
    const filters: JobSearchFilters = { sort };
    if (query) filters.search = query;
    if (employmentType) filters.employmentType = employmentType;
    if (locationType === "remote") filters.remote = true;
    else if (locationType === "onsite") filters.remote = false;
    if (compensationKind) filters.compensationKind = compensationKind;
    const minPayNum = Number(minPay);
    if (Number.isFinite(minPayNum) && minPayNum > 0) filters.minPay = minPayNum;
    if (companyOnly) filters.companyOnly = true;
    return filters;
  }, [
    activeSavedId,
    savedSearches,
    query,
    employmentType,
    locationType,
    compensationKind,
    minPay,
    sort,
    companyOnly,
  ]);

  /** Populate the controls from a filter set (applying a saved search). */
  const hydrateFilters = useCallback((f: JobSearchFilters) => {
    setEmploymentType(f.employmentType || "");
    setLocationType(
      f.remote === true ? "remote" : f.remote === false ? "onsite" : "",
    );
    setCompensationKind(f.compensationKind || "");
    setMinPay(f.minPay ? String(f.minPay) : "");
    setMinPayDraft(f.minPay ? String(f.minPay) : "");
    setSort(
      f.sort === "closing" || f.sort === "newest" ? f.sort : "trending",
    );
    setCompanyOnly(!!f.companyOnly);
    setQuery(f.search || "");
    setSearchInput(f.search || "");
  }, []);

  const clearFilters = useCallback(() => {
    setActiveSavedId(null);
    setSearchInput("");
    setQuery("");
    setEmploymentType("");
    setLocationType("");
    setCompensationKind("");
    setMinPay("");
    setMinPayDraft("");
    setSort("trending");
    setCompanyOnly(false);
    setView("all");
  }, []);

  // Count of advanced filters in effect, for the Filters button badge.
  const advancedFilterCount =
    (employmentType ? 1 : 0) +
    (locationType ? 1 : 0) +
    (compensationKind ? 1 : 0) +
    (Number(minPay) > 0 ? 1 : 0) +
    (sort !== "trending" ? 1 : 0) +
    (companyOnly ? 1 : 0);

  const load = useCallback(
    async (requestedPage = 1) => {
      if (requestedPage === 1) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        if (view === "saved" && !activeSavedId) {
          const response = await fetchSavedJobPostings();
          setJobs(response.data || []);
          setTotal((response.data || []).length);
          setPage(1);
          return;
        }
        const response = await fetchJobPostings({
          page: requestedPage,
          limit,
          ...activeFilters,
        });
        setJobs((current) =>
          requestedPage === 1
            ? response.data || []
            : [...current, ...(response.data || [])],
        );
        setTotal(response.pagination?.total ?? 0);
        setPage(requestedPage);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load jobs");
      } finally {
        if (requestedPage === 1) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [activeFilters, activeSavedId, view],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  useEffect(() => {
    // Signed-out visitors have none; a failure here should not block browsing.
    void fetchJobSavedSearches()
      .then((res) => {
        const searches = res.data || [];
        setSavedSearches(searches);
        // In-app job alerts: one-shot new-match counts per saved search.
        void Promise.all(
          searches.map((saved) =>
            fetchJobSavedSearchMatches(saved.id)
              .then((matches) => [saved.id, matches.count] as const)
              .catch(() => [saved.id, 0] as const)
          )
        ).then((pairs) =>
          setSavedSearchMatches(
            Object.fromEntries(pairs.filter(([, count]) => count > 0))
          )
        );
      })
      .catch(() => setSavedSearches([]));
  }, []);

  const saveCurrentSearch = useCallback(async () => {
    setSavingSearch(true);
    setError(null);
    try {
      const res = await createJobSavedSearch({
        name: suggestJobSavedSearchName(activeFilters),
        filters: activeFilters,
        notify: true,
      });
      setSavedSearches((current) => [res.data, ...current]);
      setActiveSavedId(res.data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this search");
    } finally {
      setSavingSearch(false);
    }
  }, [activeFilters]);

  const toggleSearchAlerts = useCallback(async (saved: JobSavedSearch) => {
    const notify = !saved.notify;
    setSavedSearches((current) =>
      current.map((item) =>
        item.id === saved.id ? { ...item, notify } : item,
      ),
    );
    try {
      await updateJobSavedSearch(saved.id, { notify });
    } catch (e) {
      setSavedSearches((current) =>
        current.map((item) =>
          item.id === saved.id ? { ...item, notify: saved.notify } : item,
        ),
      );
      setError(e instanceof Error ? e.message : "Could not update alerts");
    }
  }, []);

  const removeSavedSearch = useCallback(
    async (saved: JobSavedSearch) => {
      setSavedSearches((current) =>
        current.filter((item) => item.id !== saved.id),
      );
      if (activeSavedId === saved.id) setActiveSavedId(null);
      try {
        await deleteJobSavedSearch(saved.id);
      } catch (e) {
        setSavedSearches((current) => [saved, ...current]);
        setError(
          e instanceof Error ? e.message : "Could not delete this search",
        );
      }
    },
    [activeSavedId],
  );

  const toggleSaved = useCallback(
    async (job: JobPosting) => {
      const nextSaved = !job.isSaved;
      setSavingId(job.id);
      setError(null);
      setJobs((current) =>
        current.map((item) =>
          item.id === job.id ? { ...item, isSaved: nextSaved } : item,
        ),
      );
      try {
        await setJobPostingSaved(job.id, nextSaved);
        if (!nextSaved && view === "saved") {
          setJobs((current) => current.filter((item) => item.id !== job.id));
          setTotal((current) => Math.max(0, current - 1));
        }
      } catch (e) {
        setJobs((current) =>
          current.map((item) =>
            item.id === job.id ? { ...item, isSaved: job.isSaved } : item,
          ),
        );
        setError(
          e instanceof Error ? e.message : "Could not update saved jobs",
        );
      } finally {
        setSavingId(null);
      }
    },
    [view],
  );

  return (
    /* ScreenHeader safeTop already pays the top inset, so `edges={[]}`; the
       list keeps its own tab-bar clearance, so `bottom="none"`. What was
       missing is `keyboard`: this app targets SDK 36, where Android no longer
       honours adjustResize, so with no KeyboardAvoidingView the window never
       resizes, the scroll viewport never shrinks, and a covered input cannot
       be scrolled to. The offset is measured, because a bare KAV under the
       in-flow TopBar under-lifts by the bar's (animating) height. */
    <Screen edges={[]} bottom="none" keyboard>
      {/* No back button: Jobs is a root tab destination now, not a screen
          reached from inside the marketplace. */}
      <ScreenHeader safeTop
        title="Jobs"
        subtitle="Explore opportunities"
        right={
          <Pressable
            onPress={() => navigation.navigate("CreateJob")}
            className="rounded-lg bg-lantern-primary px-3 py-2"
          >
            <Text className="text-sm font-semibold text-white">Post job</Text>
          </Pressable>
        }
      />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: tabBarClearance }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-4 pb-4">
          <Text className="text-2xl font-bold text-lantern-text">
            Find your next opportunity
          </Text>
          <Text className="mt-1 text-sm leading-5 text-lantern-text-secondary">
            Search roles from companies, organizations, and independent posters.
          </Text>
        </View>

        <View className="mx-4 rounded-2xl border border-lantern-border bg-lantern-surface p-3">
          <TextInput
            className="h-12 rounded-xl border border-lantern-border bg-lantern-background px-4 text-sm text-lantern-text"
            placeholder="Job title, skill, or company"
            placeholderTextColor="#94a3b8"
            value={searchInput}
            onChangeText={setSearchInput}
            returnKeyType="search"
            onSubmitEditing={() => {
              const nextQuery = searchInput.trim();
              if (nextQuery === query) void load(1);
              else setQuery(nextQuery);
            }}
          />
          <Pressable
            onPress={() => {
              const nextQuery = searchInput.trim();
              if (nextQuery === query) void load(1);
              else setQuery(nextQuery);
            }}
            className="mt-2 h-11 items-center justify-center rounded-xl bg-lantern-primary"
          >
            <Text className="text-sm font-semibold text-white">
              Search jobs
            </Text>
          </Pressable>
          {!isEmptyJobSearchFilters(activeFilters) && !activeSavedId ? (
            <Pressable
              disabled={savingSearch}
              onPress={() => void saveCurrentSearch()}
              className="mt-2 h-11 flex-row items-center justify-center gap-2 rounded-xl border border-lantern-primary"
            >
              <Ionicons
                name="notifications-outline"
                size={16}
                color="#0f766e"
              />
              <Text className="text-sm font-semibold text-lantern-primary">
                {savingSearch ? "Saving…" : "Save search & get alerts"}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* Both sides of the market, above the fold: a seeker should not have
            to scroll past every listing to reach their own applications, and a
            poster should not have to guess that Jobs is also where they hire. */}
        <View className="mx-4 mt-3 flex-row gap-2">
          {(
            [
              { label: "My applications", icon: "document-text-outline", screen: "MyJobApplications" },
              { label: "My job posts", icon: "megaphone-outline", screen: "MyJobPostings" },
              { label: "Employer hub", icon: "business-outline", screen: "JobEmployer" },
            ] as const
          ).map((row) => (
            <Pressable
              key={row.screen}
              onPress={() => navigation.navigate(row.screen)}
              accessibilityRole="button"
              accessibilityLabel={row.label}
              className="flex-1 items-center gap-1 rounded-xl border border-lantern-border bg-lantern-surface px-2 py-2.5"
              style={{ minHeight: 64 }}
            >
              <Ionicons name={row.icon} size={18} color="#6366f1" />
              <Text
                numberOfLines={2}
                className="text-center text-[11px] font-semibold text-lantern-primary"
              >
                {row.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingVertical: 12,
            gap: 8,
          }}
        >
          <FilterChip
            label="All jobs"
            active={view === "all"}
            onPress={() => {
              setActiveSavedId(null);
              setView("all");
            }}
          />
          <FilterChip
            label="Saved"
            active={view === "saved"}
            onPress={() => {
              setActiveSavedId(null);
              setView("saved");
            }}
          />
          {QUICK_TYPE_CHIPS.map((type) => (
            <FilterChip
              key={type}
              label={JOB_EMPLOYMENT_TYPE_LABELS[type]}
              active={view === "all" && employmentType === type}
              onPress={() => {
                setActiveSavedId(null);
                setView("all");
                setEmploymentType((current) =>
                  current === type ? "" : type,
                );
              }}
            />
          ))}
          <FilterChip
            label="Remote"
            active={view === "all" && locationType === "remote"}
            onPress={() => {
              setActiveSavedId(null);
              setView("all");
              setLocationType((current) =>
                current === "remote" ? "" : "remote",
              );
            }}
          />
          <FilterChip
            label="Companies"
            active={view === "all" && companyOnly}
            onPress={() => {
              setActiveSavedId(null);
              setView("all");
              setCompanyOnly((current) => !current);
            }}
          />
          <FilterChip
            label="Filters"
            active={showFilters}
            badge={advancedFilterCount}
            onPress={() => setShowFilters((current) => !current)}
          />
        </ScrollView>

        {showFilters ? (
          <View className="mx-4 mb-4 rounded-2xl border border-lantern-border bg-lantern-surface p-4">
            <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary">
              Job type
            </Text>
            <View className="mt-2 flex-row flex-wrap gap-2">
              <SelectPill
                label="All types"
                active={!employmentType}
                onPress={() => {
                  setActiveSavedId(null);
                  setEmploymentType("");
                }}
              />
              {JOB_EMPLOYMENT_TYPES.map((type) => (
                <SelectPill
                  key={type}
                  label={JOB_EMPLOYMENT_TYPE_LABELS[type]}
                  active={employmentType === type}
                  onPress={() => {
                    setActiveSavedId(null);
                    setEmploymentType(type);
                  }}
                />
              ))}
            </View>

            <Text className="mt-4 text-xs font-semibold uppercase text-lantern-text-tertiary">
              Location
            </Text>
            <View className="mt-2 flex-row flex-wrap gap-2">
              {LOCATION_OPTIONS.map((option) => (
                <SelectPill
                  key={option.id || "any-location"}
                  label={option.label}
                  active={locationType === option.id}
                  onPress={() => {
                    setActiveSavedId(null);
                    setLocationType(option.id);
                  }}
                />
              ))}
            </View>

            <Text className="mt-4 text-xs font-semibold uppercase text-lantern-text-tertiary">
              Compensation
            </Text>
            <View className="mt-2 flex-row flex-wrap gap-2">
              {COMPENSATION_OPTIONS.map((option) => (
                <SelectPill
                  key={option.id || "any-pay"}
                  label={option.label}
                  active={compensationKind === option.id}
                  onPress={() => {
                    setActiveSavedId(null);
                    setCompensationKind(option.id);
                  }}
                />
              ))}
            </View>

            <Text className="mt-4 text-xs font-semibold uppercase text-lantern-text-tertiary">
              Minimum pay (₦)
            </Text>
            <TextInput
              className="mt-2 h-11 rounded-xl border border-lantern-border bg-lantern-background px-3 text-sm text-lantern-text"
              placeholder="e.g. 50000"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
              value={minPayDraft}
              onChangeText={(text) =>
                setMinPayDraft(text.replace(/[^0-9]/g, ""))
              }
              onEndEditing={() => {
                setActiveSavedId(null);
                setMinPay(minPayDraft);
              }}
              returnKeyType="done"
              onSubmitEditing={() => {
                setActiveSavedId(null);
                setMinPay(minPayDraft);
              }}
            />

            <Text className="mt-4 text-xs font-semibold uppercase text-lantern-text-tertiary">
              Sort by
            </Text>
            <View className="mt-2 flex-row flex-wrap gap-2">
              {SORT_OPTIONS.map((option) => (
                <SelectPill
                  key={option.id}
                  label={option.label}
                  active={sort === option.id}
                  onPress={() => {
                    setActiveSavedId(null);
                    setSort(option.id);
                  }}
                />
              ))}
            </View>

            <Pressable
              onPress={() => {
                setActiveSavedId(null);
                setCompanyOnly((current) => !current);
              }}
              className="mt-4 flex-row items-center gap-2"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: companyOnly }}
            >
              <Ionicons
                name={companyOnly ? "checkbox" : "square-outline"}
                size={20}
                color={companyOnly ? "#0f766e" : "#94a3b8"}
              />
              <Text className="text-sm text-lantern-text-secondary">
                Company roles only
              </Text>
            </Pressable>

            <View className="mt-4 flex-row gap-2">
              <Pressable
                onPress={() => {
                  setActiveSavedId(null);
                  setMinPay(minPayDraft);
                  setShowFilters(false);
                }}
                className="h-11 flex-1 items-center justify-center rounded-xl bg-lantern-primary"
              >
                <Text className="text-sm font-semibold text-white">
                  Apply filters
                </Text>
              </Pressable>
              {advancedFilterCount > 0 || employmentType || query ? (
                <Pressable
                  onPress={clearFilters}
                  className="h-11 items-center justify-center rounded-xl border border-lantern-border px-4"
                >
                  <Text className="text-sm font-semibold text-lantern-primary">
                    Clear
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {savedSearches.length ? (
          <View className="mx-4 mb-4 rounded-2xl border border-lantern-border bg-lantern-surface p-3">
            <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary">
              Saved searches
            </Text>
            {savedSearches.map((saved) => (
              <View
                key={saved.id}
                className="mt-2 flex-row items-center gap-2 border-t border-lantern-border pt-2"
              >
                <Pressable
                  className="flex-1 flex-row items-center gap-2"
                  onPress={() => {
                    // Reflect the saved search in the controls, then mark it
                    // active for the highlight; the two agree, so a later edit
                    // to any control seamlessly takes over.
                    hydrateFilters(saved.filters);
                    setView("all");
                    setActiveSavedId(saved.id);
                  }}
                >
                  {savedSearchMatches[saved.id] ? (
                    <View
                      accessibilityLabel={`${savedSearchMatches[saved.id]} new matches`}
                      className="rounded-full bg-lantern-primary px-1.5 py-0.5"
                    >
                      <Text className="text-[10px] font-bold text-white">
                        {savedSearchMatches[saved.id]}
                      </Text>
                    </View>
                  ) : null}
                  <Text
                    className={`text-sm font-semibold ${
                      activeSavedId === saved.id
                        ? "text-lantern-primary"
                        : "text-lantern-text"
                    }`}
                  >
                    {saved.name}
                  </Text>
                  <Text className="text-xs text-lantern-text-tertiary">
                    {describeJobSearchFilters(saved.filters)}
                  </Text>
                </Pressable>
                <Pressable
                  hitSlop={8}
                  onPress={() => void toggleSearchAlerts(saved)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: saved.notify }}
                  accessibilityLabel={
                    saved.notify
                      ? `Turn off alerts for ${saved.name}`
                      : `Turn on alerts for ${saved.name}`
                  }
                >
                  <Ionicons
                    name={
                      saved.notify
                        ? "notifications"
                        : "notifications-off-outline"
                    }
                    size={20}
                    color={saved.notify ? "#0f766e" : "#94a3b8"}
                  />
                </Pressable>
                <Pressable
                  hitSlop={8}
                  onPress={() => void removeSavedSearch(saved)}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${saved.name}`}
                >
                  <Ionicons name="trash-outline" size={20} color="#94a3b8" />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        <View className="px-4">
          <Text className="mb-3 text-base font-semibold text-lantern-text">
            {loading
              ? "Finding opportunities…"
              : view === "saved"
                ? `${total} saved ${total === 1 ? "job" : "jobs"}`
                : `${total} ${total === 1 ? "job" : "jobs"} found`}
          </Text>

          {loading ? (
            <ActivityIndicator color="#0f766e" className="my-8" />
          ) : null}
          {error ? (
            <View className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3">
              <Text className="text-sm text-red-700">{error}</Text>
              <Pressable onPress={() => void load(1)} className="mt-2">
                <Text className="text-sm font-semibold text-red-700">
                  Try again
                </Text>
              </Pressable>
            </View>
          ) : null}

          {!loading &&
            jobs.map((job) => {
              const employer =
                job.company?.displayName ||
                job.poster?.name ||
                job.poster?.username ||
                "Independent poster";
              const duration = formatJobEngagementDuration(
                job.engagementDuration,
              );
              return (
                <Pressable
                  key={job.id}
                  onPress={() =>
                    navigation.navigate("JobDetail", { jobId: job.id })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`${job.title} at ${employer}`}
                >
                  <Card
                    className={`mb-3 border ${
                      job.isSponsored
                        ? "border-amber-300"
                        : "border-lantern-border"
                    }`}
                  >
                    <View className="flex-row gap-3">
                      {job.company?.logoUrl ? (
                        <Image
                          source={{ uri: job.company.logoUrl }}
                          className="h-12 w-12 rounded-xl border border-lantern-border bg-white"
                          resizeMode="contain"
                        />
                      ) : (
                        <View className="h-12 w-12 items-center justify-center rounded-xl bg-lantern-primary/10">
                          <Text className="text-lg font-bold text-lantern-primary">
                            {employer.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View className="min-w-0 flex-1">
                        <View className="flex-row flex-wrap items-center gap-1">
                          <Text className="flex-shrink font-semibold text-lantern-text">
                            {job.title}
                          </Text>
                          {job.hasApplied ? (
                            <Text className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                              APPLIED
                            </Text>
                          ) : null}
                          {job.isSponsored ? (
                            <Text className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                              FEATURED
                            </Text>
                          ) : null}
                        </View>
                        <Text
                          className="mt-1 text-sm text-lantern-text-secondary"
                          numberOfLines={1}
                        >
                          {employer}
                          {" · "}
                          {job.company?.verificationStatus === "verified"
                            ? "Verified company"
                            : job.companyId
                              ? "Unverified company"
                              : "Individual poster"}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => void toggleSaved(job)}
                        disabled={savingId === job.id}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityState={{ selected: !!job.isSaved }}
                        accessibilityLabel={
                          job.isSaved ? "Remove from saved jobs" : "Save job"
                        }
                        className="-mr-1 p-1"
                      >
                        <Ionicons
                          name={job.isSaved ? "bookmark" : "bookmark-outline"}
                          size={20}
                          color={job.isSaved ? "#0f766e" : "#94a3b8"}
                        />
                      </Pressable>
                    </View>

                    <View className="mt-3 flex-row flex-wrap gap-2">
                      <Text className="rounded-full bg-lantern-background px-2 py-1 text-xs text-lantern-text-secondary">
                        {formatJobLocation(job)}
                      </Text>
                      <Text className="rounded-full bg-lantern-background px-2 py-1 text-xs text-lantern-text-secondary">
                        {JOB_EMPLOYMENT_TYPE_LABELS[job.employmentType]}
                      </Text>
                      <Text className="rounded-full bg-lantern-primary/10 px-2 py-1 text-xs font-medium text-lantern-primary">
                        {formatJobCompensation(job.compensation)}
                      </Text>
                      {duration ? (
                        <Text className="rounded-full bg-lantern-background px-2 py-1 text-xs text-lantern-text-secondary">
                          {duration}
                        </Text>
                      ) : null}
                      {job.applyMode === "in_app" || job.applyMode === "both" ? (
                        <Text className="rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          Easy Apply
                        </Text>
                      ) : null}
                      {typeof job.applicationsCount === "number" &&
                      job.applicationsCount < 5 &&
                      !job.hasApplied ? (
                        <Text className="rounded-full bg-lantern-primary/10 px-2 py-1 text-xs font-medium text-lantern-primary">
                          Be an early applicant
                        </Text>
                      ) : null}
                    </View>

                    <Text
                      className="mt-3 text-sm leading-5 text-lantern-text-secondary"
                      numberOfLines={2}
                    >
                      {job.description}
                    </Text>
                    <View className="mt-3 flex-row items-center gap-3">
                      <Text className="text-xs text-lantern-text-tertiary">
                        {formatJobPostedDate(job.createdAt)}
                      </Text>
                      {formatJobDeadline(job.deadline) ? (
                        <Text className="text-xs font-medium text-amber-700">
                          {formatJobDeadline(job.deadline)}
                        </Text>
                      ) : null}
                    </View>
                  </Card>
                </Pressable>
              );
            })}

          {!loading && !error && jobs.length === 0 ? (
            <View className="rounded-2xl border border-dashed border-lantern-border bg-lantern-surface p-8">
              <Text className="text-center text-base font-semibold text-lantern-text">
                {view === "saved" ? "No saved jobs yet" : "No matching jobs"}
              </Text>
              <Text className="mt-2 text-center text-sm text-lantern-text-secondary">
                {view === "saved"
                  ? "Tap the bookmark on any job to keep it here for later."
                  : "Try another search or choose a different filter."}
              </Text>
              <Pressable
                onPress={() => {
                  if (view === "saved") {
                    setActiveSavedId(null);
                    setView("all");
                  } else {
                    clearFilters();
                  }
                }}
                className="mt-4 items-center"
              >
                <Text className="text-sm font-semibold text-lantern-primary">
                  {view === "saved" ? "Browse jobs" : "Clear filters"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {!loading && jobs.length < total ? (
            <Pressable
              disabled={loadingMore}
              onPress={() => void load(page + 1)}
              className="mt-2 items-center rounded-xl border border-lantern-border bg-lantern-surface py-3"
            >
              {loadingMore ? (
                <ActivityIndicator color="#0f766e" />
              ) : (
                <Text className="text-sm font-semibold text-lantern-primary">
                  Load more jobs
                </Text>
              )}
            </Pressable>
          ) : null}

          <Text className="mt-5 text-xs leading-5 text-lantern-text-tertiary">
            {JOBS_COMPLIANCE_BANNER}
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

export default JobsHomeScreen;
