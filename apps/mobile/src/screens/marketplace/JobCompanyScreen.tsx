import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  JOB_COMPANY_VERIFICATION_LABELS,
  JOB_EMPLOYMENT_TYPE_LABELS,
  formatJobCompensation,
  formatJobLocation,
  getJobEmployerTrustPresentation,
  type JobCompany,
  type JobCompanyMemberRole,
  type JobPosting,
} from "@lantern/shared";
import { Card, ScreenHeader } from "../../components/ui";
import { fetchJobCompanyProfile } from "../../services/jobsBoard";
import type { MarketStackParamList } from "../../navigation/types";
import { useTabBarClearance } from '../../components/layout/BottomTabBar';

export function JobCompanyScreen() {
  // Scroll content must clear the absolutely-positioned bottom tab bar.
  const tabBarClearance = useTabBarClearance(16);
  const navigation =
    useNavigation<NativeStackNavigationProp<MarketStackParamList>>();
  const route = useRoute<RouteProp<MarketStackParamList, "JobCompany">>();
  const [company, setCompany] = useState<JobCompany | null>(null);
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [myRole, setMyRole] = useState<JobCompanyMemberRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    void fetchJobCompanyProfile(route.params.companyId)
      .then((res) => {
        const data = res.data as {
          company: JobCompany;
          jobs: JobPosting[];
          myRole?: JobCompanyMemberRole | null;
        };
        setCompany(data.company);
        setJobs(data.jobs || []);
        setMyRole(data.myRole || null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Company not found"),
      );
  }, [route.params.companyId]);

  return (
    <View className="flex-1 bg-lantern-background">
      <ScreenHeader safeTop title="Company" onBack={() => navigation.goBack()} />
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: tabBarClearance }}
      >
        {error ? (
          <Text className="text-red-600 text-sm mt-4">{error}</Text>
        ) : null}
        {!company && !error ? (
          <ActivityIndicator className="mt-8" color="#0f766e" />
        ) : null}
        {company ? (
          <>
            <Card className="mb-3">
              <View className="flex-row items-start gap-3">
                {company.logoUrl ? (
                  <Image
                    source={{ uri: company.logoUrl }}
                    className="h-14 w-14 rounded-xl bg-white"
                    resizeMode="contain"
                  />
                ) : (
                  <View className="h-14 w-14 rounded-xl bg-lantern-primary/10 items-center justify-center">
                    <Text className="text-xl font-bold text-lantern-primary">
                      {company.displayName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View className="flex-1">
                  {(() => {
                    const trust = getJobEmployerTrustPresentation({
                      companyId: company.id,
                      company,
                    });
                    const toneClass =
                      trust.tone === "positive"
                        ? "bg-emerald-100 text-emerald-800"
                        : trust.tone === "caution"
                          ? "bg-amber-100 text-amber-900"
                          : "bg-slate-100 text-slate-700";
                    return (
                      <View className="flex-row flex-wrap items-center gap-2 mb-1">
                        <Text
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${toneClass}`}
                        >
                          {trust.label}
                        </Text>
                        {myRole ? (
                          <Text className="text-[11px] text-lantern-text-tertiary">
                            Your role: {myRole}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })()}
                  <Text className="text-lg font-bold text-lantern-text">
                    {company.displayName}
                  </Text>
                  {company.tagline ? (
                    <Text className="text-sm text-lantern-text-secondary mt-1">
                      {company.tagline}
                    </Text>
                  ) : null}
                  <Text className="text-xs text-lantern-text-tertiary mt-1">
                    {[company.industry, company.hqLocation]
                      .filter(Boolean)
                      .join(" · ") ||
                      JOB_COMPANY_VERIFICATION_LABELS[
                        company.verificationStatus as keyof typeof JOB_COMPANY_VERIFICATION_LABELS
                      ] ||
                      company.verificationStatus}
                  </Text>
                  {company.website ? (
                    <Pressable
                      onPress={() => void Linking.openURL(company.website!)}
                    >
                      <Text className="text-sm text-lantern-primary mt-1">
                        Website
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
              {myRole &&
              company.verificationStatus === "rejected" &&
              company.verificationNote ? (
                <Text className="text-sm text-red-700 mt-3">
                  Verification note: {company.verificationNote}
                </Text>
              ) : null}
              {company.about ? (
                <View className="mt-3">
                  <Text className="text-sm font-semibold text-lantern-text mb-1">
                    About
                  </Text>
                  <Text className="text-sm text-lantern-text-secondary">
                    {company.about}
                  </Text>
                </View>
              ) : null}
            </Card>

            <Text className="font-semibold text-lantern-text mb-2">
              Open roles
            </Text>
            {jobs.length === 0 ? (
              <Text className="text-sm text-lantern-text-tertiary">
                No open roles right now.
              </Text>
            ) : (
              jobs.map((job) => (
                <Pressable
                  key={job.id}
                  className="mb-2"
                  onPress={() =>
                    navigation.navigate("JobDetail", { jobId: job.id })
                  }
                >
                  <Card>
                    <View className="flex-row flex-wrap items-center gap-2">
                      <Text className="font-medium text-lantern-text">
                        {job.title}
                      </Text>
                      {job.hasApplied ? (
                        <Text className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-800">
                          Applied
                        </Text>
                      ) : null}
                    </View>
                    <Text className="text-xs text-lantern-text-tertiary mt-1">
                      {formatJobLocation(job)} ·{" "}
                      {JOB_EMPLOYMENT_TYPE_LABELS[job.employmentType]} ·{" "}
                      {formatJobCompensation(job.compensation)}
                    </Text>
                  </Card>
                </Pressable>
              ))
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

export default JobCompanyScreen;
