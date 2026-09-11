import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  PLAY_MODES,
  PLAY_REVIEW_COPY,
  PLAY_SECONDS,
  answerPlayQuestion,
  currentPlayQuestion,
  expirePlaySession,
  materialsForCourse,
  playBlockerCopy,
  playModeBlocker,
  playScoreLine,
  playStudioBlocker,
  playableCards,
  startPlaySession,
  type PlayModeId,
  type PlaySession,
} from '@lantern/shared';
import type { StudyStackParamList } from '../../navigation/types';
import { Button, FeatureDisc, ScreenHeader, T } from '../../components/ui';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useToastStore } from '../../stores/toastStore';

type Props = NativeStackScreenProps<StudyStackParamList, 'PlayStudio'>;

export function PlayStudioScreen({ navigation, route }: Props) {
  const { courseId, courseLabel } = route.params;
  const tabBarClearance = useTabBarClearance(16);
  const decks = useFlashcardStore((s) => s.decks);
  const flashcards = useFlashcardStore((s) => s.flashcards);
  const fetchFlashcards = useFlashcardStore((s) => s.fetchFlashcards);
  const showToast = useToastStore((s) => s.showToast);

  const courseDecks = useMemo(() => materialsForCourse(decks, courseId), [decks, courseId]);
  const [deckId, setDeckId] = useState(courseDecks[0]?.id || '');
  const [session, setSession] = useState<PlaySession | null>(null);
  const [remaining, setRemaining] = useState(PLAY_SECONDS);

  useEffect(() => {
    if (deckId && courseDecks.some((deck) => deck.id === deckId)) return;
    setDeckId(courseDecks[0]?.id || '');
  }, [courseDecks, deckId]);

  useEffect(() => {
    if (!deckId) return;
    void fetchFlashcards(deckId).catch(() => undefined);
  }, [deckId, fetchFlashcards]);

  const deck = courseDecks.find((row) => row.id === deckId) ?? courseDecks[0] ?? null;
  const cards = useMemo(
    () => playableCards(flashcards[deck?.id ?? ''] ?? []),
    [flashcards, deck?.id]
  );
  const hubBlocker = playStudioBlocker(courseDecks.length);
  const thinBlocker = playModeBlocker(cards);

  useEffect(() => {
    if (!session || session.status !== 'playing') return;
    setRemaining(PLAY_SECONDS);
    const timer = setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          clearInterval(timer);
          setSession((current) => (current ? expirePlaySession(current) : current));
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [session?.deckId, session?.mode, session?.status]);

  const startMode = (mode: PlayModeId) => {
    if (!deck) {
      showToast(playBlockerCopy('no_deck') ?? 'File a deck in this course first.', 'info');
      return;
    }
    if (thinBlocker) {
      showToast(playBlockerCopy(thinBlocker) ?? '', 'info');
      return;
    }
    if (mode === 'match') {
      navigation.navigate('MatchStudy', { deckId: deck.id, deckName: deck.name });
      return;
    }
    const next = startPlaySession({ mode, deckId: deck.id, deckName: deck.name, cards });
    if (!next) return;
    setSession(next);
  };

  const question = session && session.status === 'playing' ? currentPlayQuestion(session) : null;

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScreenHeader title={courseLabel || 'Play'} onBack={() => navigation.goBack()} />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: tabBarClearance, gap: 12 }}
      >
        {session && session.status === 'playing' && question ? (
          <View className="gap-3">
            <T.Heading>{session.mode === 'speed' ? 'Speed' : 'Define'}</T.Heading>
            <T.Caption tone="secondary">
              {remaining}s · {session.index + 1} of {session.questions.length}
            </T.Caption>
            <T.Body>{question.prompt}</T.Body>
            {question.options.map((option) => (
              <Button
                key={option}
                variant="secondary"
                onPress={() => setSession((current) => (current ? answerPlayQuestion(current, option) : current))}
              >
                {option}
              </Button>
            ))}
            <Button variant="secondary" onPress={() => setSession(null)}>
              Back to Play
            </Button>
          </View>
        ) : session && session.status === 'results' ? (
          <View className="gap-3">
            <T.Heading>Results</T.Heading>
            <T.Title>{playScoreLine(session)}</T.Title>
            <T.Caption tone="secondary">{session.deckName}</T.Caption>
            {session.missedCardIds.length > 0 ? (
              <Button
                onPress={() =>
                  navigation.navigate('CramSession', {
                    deckId: session.deckId,
                    deckName: session.deckName,
                    cardIds: session.missedCardIds,
                  })
                }
              >
                {PLAY_REVIEW_COPY}
              </Button>
            ) : (
              <T.Body tone="secondary">No missed cards this round.</T.Body>
            )}
            <Button variant="secondary" onPress={() => setSession(null)}>
              Play again
            </Button>
          </View>
        ) : (
          <View className="gap-3">
            <T.Heading>Play</T.Heading>
            <T.Body tone="secondary">Games from this course’s cards. Group duels stay in Chat.</T.Body>
            {hubBlocker ? (
              <T.Body tone="secondary">{playBlockerCopy(hubBlocker)}</T.Body>
            ) : (
              <>
                {courseDecks.length > 1
                  ? courseDecks.map((row) => (
                      <Pressable
                        key={row.id}
                        onPress={() => setDeckId(row.id)}
                        className={`min-h-[44px] rounded-xl border px-3 py-2 ${
                          row.id === deck?.id
                            ? 'border-lantern-feature-flashcards-ink bg-lantern-feature-flashcards-tint'
                            : 'border-lantern-border'
                        }`}
                      >
                        <T.Body>{row.name}</T.Body>
                      </Pressable>
                    ))
                  : null}
                {PLAY_MODES.map((mode) => {
                  const blocked = thinBlocker;
                  return (
                    <Pressable
                      key={mode.id}
                      onPress={() => startMode(mode.id)}
                      className="min-h-[44px] flex-row items-center gap-3 rounded-xl border border-lantern-border px-3 py-2"
                    >
                      <FeatureDisc feature="flashcards" icon="game-controller" size={32} />
                      <View className="flex-1">
                        <T.Body>{mode.label}</T.Body>
                        <T.Caption tone="secondary">
                          {blocked ? playBlockerCopy(blocked) : mode.promise}
                        </T.Caption>
                      </View>
                    </Pressable>
                  );
                })}
              </>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default PlayStudioScreen;
