import React, { useCallback, useEffect, useState } from "react";
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
  JOB_EMPLOYMENT_TYPE_LABELS,
  formatJobCompensation,
  formatJobEngagementDuration,
  formatJobLocation,
  formatJobPostedDate,
  type JobPosting,
} from "@lantern/shared";
import { Card, ScreenHeader } from "../../components/ui";
import {
  fetchJobPostings,
  fetchSavedJobPostings,
  setJobPostingSaved,
} from "../../services/jobsBoard";
import type { MarketStackParamList } from "../../navigation/types";

const FILTERS = [
  { id: "all", label: "All jobs" },
  { id: "saved", label: "Saved" },
  { id: "full_time", label: "Full-time" },
  { id: "part_time", label: "Part-time" },
  { id: "internship", label: "Internships" },
  { id: "remote", label: "Remote" },
  { id: "company", label: "Companies" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

export function JobsHomeScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<MarketStackParamList>>();
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [savingId, setSavingId] = useState<string | null>(null);
  const limit = 12;

  const load = useCallback(
    async (requestedPage = 1) => {
      if (requestedPage === 1) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        if (filter === "saved") {
          const response = await fetchSavedJobPostings();
          setJobs(response.data || []);
          setTotal((response.data || []).length);
          setPage(1);
          return;
        }
        const response = await fetchJobPostings({
          page: requestedPage,
          limit,
          search: query || undefined,
          employmentType:
            filter === "full_time" ||
            filter === "part_time" ||
            filter === "internship"
              ? filter
              : undefined,
          remote: filter === "remote" ? true : undefined,
          companyOnly: filter === "company" ? true : undefined,
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
    [filter, query],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

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
        if (!nextSaved && filter === "saved") {
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
    [filter],
  );

  return (
    <View className="flex-1 bg-lantern-background">
      <ScreenHeader
        title="Jobs"
        subtitle="Explore opportunities"
        onBack={() => navigation.navigate("MarketplaceHome")}
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
        contentContainerStyle={{ paddingBottom: 32 }}
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
          {FILTERS.map((option) => (
            <Pressable
              key={option.id}
              onPress={() => setFilter(option.id)}
              className={`rounded-full border px-4 py-2 ${
                filter === option.id
                  ? "border-lantern-primary bg-lantern-primary"
                  : "border-lantern-border bg-lantern-surface"
              }`}
            >
              <Text
                className={`text-sm font-medium ${
                  filter === option.id
                    ? "text-white"
                    : "text-lantern-text-secondary"
                }`}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View className="mx-4 mb-4 flex-row gap-2">
          <Pressable
            onPress={() => navigation.navigate("MyJobApplications")}
            className="flex-1 items-center rounded-xl border border-lantern-border bg-lantern-surface px-2 py-3"
          >
            <Text className="text-xs font-semibold text-lantern-primary">
              My applications
            </Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate("MyJobPostings")}
            className="flex-1 items-center rounded-xl border border-lantern-border bg-lantern-surface px-2 py-3"
          >
            <Text className="text-xs font-semibold text-lantern-primary">
              My job posts
            </Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate("JobEmployer")}
            className="flex-1 items-center rounded-xl border border-lantern-border bg-lantern-surface px-2 py-3"
          >
            <Text className="text-xs font-semibold text-lantern-primary">
              Employer hub
            </Text>
          </Pressable>
        </View>

        <View className="px-4">
          <Text className="mb-3 text-base font-semibold text-lantern-text">
            {loading
              ? "Finding opportunities…"
              : filter === "saved"
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
                          {job.company?.verificationStatus === "verified"
                            ? " · ✓ Verified"
                            : ""}
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
                    </View>

                    <Text
                      className="mt-3 text-sm leading-5 text-lantern-text-secondary"
                      numberOfLines={2}
                    >
                      {job.description}
                    </Text>
                    <Text className="mt-3 text-xs text-lantern-text-tertiary">
                      {formatJobPostedDate(job.createdAt)}
                    </Text>
                  </Card>
                </Pressable>
              );
            })}

          {!loading && !error && jobs.length === 0 ? (
            <View className="rounded-2xl border border-dashed border-lantern-border bg-lantern-surface p-8">
              <Text className="text-center text-base font-semibold text-lantern-text">
                {filter === "saved" ? "No saved jobs yet" : "No matching jobs"}
              </Text>
              <Text className="mt-2 text-center text-sm text-lantern-text-secondary">
                {filter === "saved"
                  ? "Tap the bookmark on any job to keep it here for later."
                  : "Try another search or choose a different filter."}
              </Text>
              <Pressable
                onPress={() => {
                  setSearchInput("");
                  setQuery("");
                  setFilter("all");
                }}
                className="mt-4 items-center"
              >
                <Text className="text-sm font-semibold text-lantern-primary">
                  {filter === "saved" ? "Browse jobs" : "Clear filters"}
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
    </View>
  );
}

export default JobsHomeScreen;
