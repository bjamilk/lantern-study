import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {

  Modal,

  Pressable,

  RefreshControl,

  ScrollView,

  Text,

  View,

} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { Ionicons } from '@expo/vector-icons';

import { CompositeScreenProps } from '@react-navigation/native';

import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

import { useAuthStore } from '../../stores/authStore';

import { useFlashcardStore } from '../../stores/flashcardStore';

import { useGroupStore } from '../../stores/groupStore';
import { useBudgetStore } from '../../stores/budgetStore';

import { useStatsStore, type TimePeriod, type RecentTest } from '../../stores/statsStore';

import { useStudyGoalsStore } from '../../stores/studyGoalsStore';
import { useSettingsStore } from '../../stores/settingsStore';

import { useNotesStore } from '../../stores/notesStore';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import TestAnalysisModal from '../../components/TestAnalysisModal';
import { normalizeRecentTest } from '../../utils/testAnalysisHelpers';

import { useTestStore } from '../../stores/testStore';

import { Card, Button } from '../../components/ui';

import { DashboardHeroCard } from '../../components/dashboard/DashboardHeroCard';

import { DashboardQuickLinks } from '../../components/dashboard/DashboardQuickLinks';
import { GettingStartedChecklist } from '../../components/dashboard/GettingStartedChecklist';
import { useCompanionStore } from '../../stores/companionStore';

import { DailyQuestsWidget } from '../../components/DailyQuestsWidget';

import { DailyQuizWidget } from '../../components/DailyQuizWidget';
import { DailyGoalsProgress } from '../../components/DailyGoalsProgress';

import { fetchDailyQuests, recordLoginStreak, type DailyQuest } from '../../services/gamification';

import { HomeStackParamList, MainTabParamList } from '../../navigation/types';
import { featureAccents } from '@lantern/shared/design';
import { buildActivityHeatmapGrid, getActivityHeatHexColorForCount, getActivityHeatHexColor, computeStudyStreak, getDashboardFirstName, type ActivityHeatLevel } from '@lantern/shared/utils';

import { useTheme } from '../../theme';



type Props = CompositeScreenProps<

  NativeStackScreenProps<HomeStackParamList, 'Dashboard'>,

  BottomTabScreenProps<MainTabParamList>

>;



const PERIOD_OPTIONS: { value: TimePeriod; label: string }[] = [

  { value: '7days', label: '7d' },

  { value: '30days', label: '30d' },

  { value: '90days', label: '90d' },

  { value: 'all', label: 'All' },

];



function ActivityHeatmap({ days, theme }: { days: { date: string; count: number }[]; theme: 'light' | 'dark' }) {
  const legendLevels: ActivityHeatLevel[] = [0, 1, 2, 3, 4];
  const weeks: { date: string; count: number }[][] = [];

  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return (
    <View className="overflow-hidden items-center gap-2">
      <View className="flex-row flex-wrap gap-1">
        {weeks.map((week, wi) => (
          <View key={`week-${wi}`} className="gap-1">
            {week.map(day => (
              <View
                key={day.date}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  backgroundColor: getActivityHeatHexColorForCount(day.count, theme),
                }}
              />
            ))}
          </View>
        ))}
      </View>
      <View className="flex-row items-center gap-1">
        <Text className="text-xs text-lantern-text-tertiary">Less</Text>
        {legendLevels.map(level => (
          <View
            key={level}
            style={{
              width: 12,
              height: 12,
              borderRadius: 2,
              backgroundColor: getActivityHeatHexColor(level, theme),
            }}
          />
        ))}
        <Text className="text-xs text-lantern-text-tertiary">More</Text>
      </View>
    </View>
  );
}



export function DashboardScreen({ navigation }: Props) {
  const tabBarClearance = useTabBarClearance(24);

  const user = useAuthStore(s => s.user);
  const profileName = useAuthStore(s => s.profileName);
  const profileFirstName = useAuthStore(s => s.profileFirstName);

  const { decks, fetchDecks } = useFlashcardStore();

  const { groups, fetchGroups } = useGroupStore();

  const openCompanion = useCompanionStore(s => s.open);
  const companionOpen = useCompanionStore(s => s.isOpen);
  const budget = useBudgetStore(s => s.budget);
  const transactions = useBudgetStore(s => s.transactions);

  const { notes, loadNotes } = useNotesStore();

  const { stats, selectedPeriod, isLoading: statsLoading, fetchStats, setSelectedPeriod } = useStatsStore();

  const activeTest = useTestStore(s => s.activeTest);

  const {

    studyGoal,

    dailyQuiz,

    dailyQuizProgress,

    setStudyGoal,

    setDailyQuiz,

    answerDailyQuestion,

    completeDailyQuiz,

    getDailyQuizForToday,

    startDailyQuizFromContent,

  } = useStudyGoalsStore();

  const studySettings = useSettingsStore(s => s.settings.study);

  const [refreshing, setRefreshing] = useState(false);

  const [quests, setQuests] = useState<DailyQuest[]>([]);

  const [serverStreak, setServerStreak] = useState(0);

  const [quizLoading, setQuizLoading] = useState(false);

  const [groupPickerOpen, setGroupPickerOpen] = useState(false);

  const [analysisTest, setAnalysisTest] = useState<RecentTest | null>(null);



  const dueCount = useMemo(() => decks.reduce((s, d) => s + (d.due_count || 0), 0), [decks]);

  const displayName = useMemo(
    () =>
      getDashboardFirstName({
        firstName: profileFirstName || (user?.user_metadata?.first_name as string | undefined),
        name: profileName || (user?.user_metadata?.name as string | undefined),
        username: user?.user_metadata?.username as string | undefined,
      }),
    [profileFirstName, profileName, user]
  );

  const todayQuiz = getDailyQuizForToday() ?? dailyQuiz;

  const availableGroups = useMemo(() => groups.filter(g => !g.isArchived), [groups]);



  const heatmap = useMemo(

    () => buildActivityHeatmapGrid(stats?.activityDays || []),

    [stats?.activityDays]

  );



  const load = async () => {

    if (!user?.id) return;

    await Promise.all([

      fetchDecks(user.id),

      fetchGroups(user.id),

      loadNotes().catch(() => {}),

      fetchStats(user.id, selectedPeriod).catch(() => {}),

    ]);

    try {

      const streakRes = await recordLoginStreak();

      setServerStreak(
        streakRes?.current_streak ?? streakRes?.currentStreak ?? streakRes?.current ?? stats?.currentStreak ?? 0
      );

    } catch {

      setServerStreak(stats?.currentStreak ?? 0);

    }

    try {

      const q = await fetchDailyQuests();

      setQuests(q);

    } catch {

      setQuests([]);

    }

  };



  useEffect(() => {

    void load();

  }, [user?.id]);



  useEffect(() => {

    if (!user?.id) return;

    void fetchStats(user.id, selectedPeriod).catch(() => {});

  }, [selectedPeriod, user?.id]);



  const onRefresh = async () => {

    setRefreshing(true);

    await load();

    setRefreshing(false);

  };



  const startQuiz = useCallback(async () => {

    setQuizLoading(true);

    try {

      const content =

        notes.slice(0, 3).map(n => `${n.title}\n${n.body}`).join('\n\n') ||

        'Spaced repetition helps long-term memory. Active recall beats re-reading.';

      await startDailyQuizFromContent(content.slice(0, 4000), notes[0]?.id);

    } catch {

      setDailyQuiz(null);

    } finally {

      setQuizLoading(false);

    }

  }, [notes, startDailyQuizFromContent, setDailyQuiz]);



  const parent = navigation.getParent();

  const { isDark, colors } = useTheme();

  const studyActivityStreak = useMemo(
    () => computeStudyStreak(stats?.activityDays ?? []).current,
    [stats?.activityDays]
  );
  const streak = Math.max(serverStreak, studyActivityStreak, stats?.currentStreak || 0);

  const level = stats?.userLevel;



  const handlePeriodChange = (period: TimePeriod) => {

    setSelectedPeriod(period);

  };



  const handleQuickTest = () => {

    if (availableGroups.length > 1) {

      setGroupPickerOpen(true);

      return;

    }

    if (availableGroups.length === 1) {

      parent?.navigate('ChatTab', {

        screen: 'GroupChat',

        params: { groupId: availableGroups[0].id, groupName: availableGroups[0].name },

      });

      return;

    }

    parent?.navigate('StudyTab', { screen: 'TestsList' });

  };



  const handleGroupPick = (groupId: string, groupName: string) => {

    setGroupPickerOpen(false);

    parent?.navigate('ChatTab', { screen: 'GroupChat', params: { groupId, groupName } });

  };



  const handleResumeTest = () => {

    if (!activeTest) return;

    parent?.navigate('StudyTab', {

      screen: 'TestTaking',

      params: {

        testId: activeTest.test.id,

        testName: activeTest.test.name,

        mode: activeTest.mode,

      },

    });

  };



  const formatDuration = (seconds: number) => {

    const m = Math.floor(seconds / 60);

    const s = seconds % 60;

    return m > 0 ? `${m}m ${s}s` : `${s}s`;

  };



  return (

    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: tabBarClearance, paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >

        <DashboardHeroCard
          userName={displayName}
          streak={streak}
          points={stats?.totalPoints ?? 0}
          dueCount={dueCount}
          totalTests={stats?.totalTestsTaken ?? 0}
          level={level}
          onPrimaryAction={() => {
            if (dueCount > 0) {
              parent?.navigate('StudyTab', { screen: 'FlashcardsList' });
            } else {
              parent?.navigate('StudyTab', { screen: 'Library', params: { tab: 'notes' } });
            }
          }}
          primaryActionLabel={
            dueCount > 0
              ? `Review ${dueCount} due card${dueCount !== 1 ? 's' : ''}`
              : 'Import & study'
          }
        />

        <GettingStartedChecklist
          hasDecks={decks.length > 0}
          hasTests={(stats?.totalTestsTaken ?? 0) > 0}
          hasGroups={groups.length > 0}
          hasBudget={Boolean(budget?.targetAmount && budget.targetAmount > 0) || transactions.length > 0}
          hasOpenedLibrary={false}
          hasTriedCompanion={companionOpen}
          onCreateDeck={() => parent?.navigate('StudyTab', { screen: 'Library', params: { tab: 'flashcards' } })}
          onTakeTest={() => parent?.navigate('StudyTab', { screen: 'TestsList' })}
          onJoinGroup={() => parent?.navigate('ChatTab')}
          onSetBudget={() => parent?.navigate('BudgetTab')}
          onOpenLibrary={() => parent?.navigate('StudyTab', { screen: 'Library' })}
          onTryCompanion={() => openCompanion()}
          onSubmitQuestion={() => parent?.navigate('ChatTab')}
          onExploreMarketplace={() => parent?.navigate('MarketTab')}
          onTryOffline={() => {
            const root = parent?.getParent?.() ?? parent;
            (root as { navigate?: (name: string) => void } | undefined)?.navigate?.('Offline');
          }}
        />

        {activeTest ? (
          <Card className="mb-4 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">

            <View className="flex-row items-center justify-between gap-3">

              <View className="flex-1">

                <Text className="font-semibold text-amber-900 dark:text-amber-100">Test in progress</Text>

                <Text className="text-sm text-amber-700 dark:text-amber-300 mt-0.5">

                  {activeTest.test.name} — question {activeTest.currentQuestionIndex + 1} of{' '}

                  {activeTest.questions.length}

                </Text>

              </View>

              <Button size="sm" onPress={handleResumeTest}>

                Resume

              </Button>

            </View>

          </Card>

        ) : null}



        <View className="flex-row gap-2 mb-3">

          {PERIOD_OPTIONS.map(opt => (

            <Pressable

              key={opt.value}

              onPress={() => handlePeriodChange(opt.value)}

              className={`px-3 py-1.5 rounded-full ${

                selectedPeriod === opt.value

                  ? 'bg-lantern-primary'

                  : 'bg-lantern-surface border border-lantern-border'

              }`}

            >

              <Text

                className={`text-xs font-semibold ${

                  selectedPeriod === opt.value ? 'text-white' : 'text-lantern-text-secondary'

                }`}

              >

                {opt.label}

              </Text>

            </Pressable>

          ))}

        </View>



        <DailyGoalsProgress
          study={studySettings}
          activityDays={stats?.activityDays ?? []}
        />



        <View className="flex-row gap-3 mb-4">

          <Card className="flex-1 items-center py-3">

            <Text className="text-2xl font-bold text-lantern-primary">{stats?.totalTestsTaken ?? '—'}</Text>

            <Text className="text-xs text-lantern-text-secondary mt-1">Tests taken</Text>

          </Card>

          <Card className="flex-1 items-center py-3">

            <Text className="text-2xl font-bold text-lantern-accent">

              {stats?.averageTimePerQuestion ? `${stats.averageTimePerQuestion}s` : '—'}

            </Text>

            <Text className="text-xs text-lantern-text-secondary mt-1">Avg / question</Text>

          </Card>

          <Card className="flex-1 items-center py-3">

            <View className="flex-row items-center gap-1">

              <Ionicons name="flame" size={16} color="#f97316" />

              <Text className="text-2xl font-bold text-emerald-600">{streak}</Text>

            </View>

            <Text className="text-xs text-lantern-text-secondary mt-1">Streak</Text>

          </Card>

        </View>



        <Card className="mb-4">

          <Text className="text-sm font-semibold text-lantern-text mb-2">

            16-week activity

          </Text>

          {statsLoading && !stats ? (

            <Text className="text-xs text-lantern-text-tertiary">Loading activity...</Text>

          ) : (

            <>

              <ActivityHeatmap days={heatmap.days} theme={isDark ? 'dark' : 'light'} />

              <Text className="text-xs text-lantern-text-tertiary mt-2">Darker = more study activity</Text>

            </>

          )}

        </Card>



        {stats?.badges?.some(b => b.level > 0) ? (

          <View className="mb-4">

            <Text className="text-sm font-semibold text-lantern-text mb-2">Badges</Text>

            <View className="flex-row flex-wrap gap-2">

              {stats.badges.filter(b => b.level > 0).slice(0, 12).map(badge => (

                <Card key={`badge-${badge.id}`} className="w-28 items-center py-3 px-2">

                  <Ionicons

                    name={(badge.icon as keyof typeof Ionicons.glyphMap) || 'ribbon'}

                    size={22}

                    color={badge.level > 0 ? colors.primary : colors.textTertiary}

                  />

                  <Text className="text-[10px] font-semibold text-lantern-text mt-1 text-center" numberOfLines={2}>

                    {badge.name}

                  </Text>

                  {badge.level > 0 ? (

                    <Text className="text-[9px] text-lantern-primary mt-0.5">Lv {badge.level}</Text>

                  ) : (

                    <Text className="text-[9px] text-lantern-text-tertiary mt-0.5">{badge.progress}%</Text>

                  )}

                </Card>

              ))}

            </View>

          </View>

        ) : null}



        {stats?.recentTests && stats.recentTests.length > 0 ? (

          <View className="mb-4">

            <Text className="text-sm font-semibold text-lantern-text mb-2">Recent tests</Text>

            {stats.recentTests.slice(0, 5).map(test => (

              <Pressable
                key={`${test.id}-${test.completedAt}`}
                onPress={() => setAnalysisTest(normalizeRecentTest(test))}
                className="mb-2 active:opacity-90"
              >

                <Card className="py-3">

                  <View className="flex-row items-center justify-between">

                    <View className="flex-1 min-w-0 pr-2">

                      <Text className="font-medium text-lantern-text" numberOfLines={1}>

                        {test.groupName}

                      </Text>

                      <Text className="text-xs text-lantern-text-secondary mt-0.5">

                        {new Date(test.completedAt).toLocaleDateString()} · {formatDuration(test.timeSpent)}

                      </Text>

                    </View>

                    <View

                      className={`px-2 py-1 rounded-full ${

                        test.percentage >= 80

                          ? 'bg-emerald-100 dark:bg-emerald-900/40'

                          : test.percentage >= 60

                            ? 'bg-amber-100 dark:bg-amber-900/40'

                            : 'bg-red-100 dark:bg-red-900/40'

                      }`}

                    >

                      <Text

                        className={`text-sm font-bold ${

                          test.percentage >= 80

                            ? 'text-emerald-700 dark:text-emerald-300'

                            : test.percentage >= 60

                              ? 'text-amber-700 dark:text-amber-300'

                              : 'text-red-700 dark:text-red-300'

                        }`}

                      >

                        {test.percentage}%

                      </Text>

                    </View>

                  </View>

                </Card>

              </Pressable>

            ))}

          </View>

        ) : null}



        <View className="flex-row gap-3 mb-4">

          <Card className="flex-1 items-center py-4">

            <Text className="text-2xl font-bold text-lantern-primary">{dueCount}</Text>

            <Text className="text-xs text-lantern-text-secondary mt-1">Due cards</Text>

          </Card>

          <Card className="flex-1 items-center py-4">

            <Text className="text-2xl font-bold text-lantern-accent">{groups.length}</Text>

            <Text className="text-xs text-lantern-text-secondary mt-1">Groups</Text>

          </Card>

        </View>



        <Pressable

          onPress={handleQuickTest}

          className="flex-row items-center gap-3 bg-amber-500 rounded-2xl p-4 mb-4 active:opacity-90"

        >

          <View className="w-10 h-10 rounded-xl bg-white/20 items-center justify-center">

            <Ionicons name="flash" size={22} color="#fff" />

          </View>

          <View className="flex-1">

            <Text className="font-semibold text-white">Quick Test</Text>

            <Text className="text-xs text-white/80">

              {availableGroups.length > 0 ? 'Pick a group & practice' : 'Go to tests'}

            </Text>

          </View>

          <Ionicons name="chevron-forward" size={18} color="#fff" />

        </Pressable>



        <DailyQuestsWidget quests={quests} streak={streak} />



        <DailyQuizWidget

          studyGoal={studyGoal}

          dailyQuiz={todayQuiz}

          progress={dailyQuizProgress}

          loading={quizLoading}

          onStudyGoalChange={setStudyGoal}

          onStartQuiz={() => void startQuiz()}

          onAnswer={answerDailyQuestion}

          onComplete={completeDailyQuiz}

        />



        <Text className="text-sm font-semibold text-lantern-text mb-2">Quick actions</Text>

        <DashboardQuickLinks
          links={[
            {
              id: 'flashcards',
              label: 'Flashcards',
              icon: 'layers',
              iconColor: '#059669',
              badge: dueCount,
              onPress: () => parent?.navigate('StudyTab', { screen: 'Library', params: { tab: 'flashcards' } }),
            },
            {
              id: 'notes',
              label: 'Notes',
              icon: 'document-text',
              iconColor: featureAccents.library,
              onPress: () => parent?.navigate('StudyTab', { screen: 'Library', params: { tab: 'notes' } }),
            },
            {
              id: 'tests',
              label: 'Tests',
              icon: 'help-circle',
              iconColor: '#d97706',
              onPress: () => parent?.navigate('StudyTab', { screen: 'TestsList' }),
            },
            {
              id: 'marketplace',
              label: 'Explore',
              icon: 'bag',
              iconColor: featureAccents.marketplace,
              onPress: () => parent?.navigate('MarketTab'),
            },
          ]}
        />

      </ScrollView>



      <Modal visible={groupPickerOpen} transparent animationType="fade" onRequestClose={() => setGroupPickerOpen(false)}>

        <Pressable className="flex-1 bg-black/40 justify-center px-6" onPress={() => setGroupPickerOpen(false)}>

          <Pressable onPress={e => e.stopPropagation?.()} className="bg-lantern-surface rounded-2xl p-4 border border-lantern-border">

            <Text className="text-lg font-bold text-lantern-text mb-3">Pick a group</Text>

            {availableGroups.map(g => (

              <Pressable

                key={g.id}

                onPress={() => handleGroupPick(g.id, g.name)}

                className="py-3 border-b border-lantern-border"

              >

                <Text className="text-lantern-text font-medium">{g.name}</Text>

              </Pressable>

            ))}

            <Button

              variant="secondary"

              className="mt-3"

              onPress={() => {

                setGroupPickerOpen(false);

                parent?.navigate('StudyTab', { screen: 'TestsList' });

              }}

            >

              All tests instead

            </Button>

          </Pressable>

        </Pressable>

      </Modal>



      <TestAnalysisModal

        visible={!!analysisTest}

        onClose={() => setAnalysisTest(null)}

        test={analysisTest}

      />

    </SafeAreaView>

  );

}


