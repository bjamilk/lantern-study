/**
 * The `PlayStudio` route in the Study stack: the game door for one set or
 * course. The student picks a deck and a play mode (speed, define, match) and
 * plays a timed round over that deck's cards, then can cram the ones they missed.
 *
 * Main exports: `PlayStudioScreen` (also the default).
 * Touches: flashcardStore (decks, cards, `fetchFlashcards`), toastStore for the
 * blocker messages. Navigates to MatchStudy, CramSession, StudySetUpload,
 * StudySetLibrary and Library. No services and no native modules — the session
 * rules, copy and blockers all come from @lantern/shared.
 *
 * Gotchas: Match is not a session here — it hands off to the `MatchStudy` screen,
 * so only speed/define ever produce a local `PlaySession`. The countdown effect
 * is keyed on `session.deckId/mode/status` rather than on the session object, so
 * answering a question does not restart the clock. Sessions are in-memory only
 * and are lost when the screen unmounts.
 */
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
  studioMaterials,
  playBlockerCopy,
  playEmptyCopy,
  playTaglineCopy,
  scopeNoun,
  playModeBlocker,
  playScoreLine,
  playStudioBlocker,
  playableCards,
  startPlaySession,
  type PlayModeId,
  type PlaySession,
} from '@lantern/shared';
import type { StudyStackParamList } from '../../navigation/types';
import {
  Button,
  FeatureDisc,
  ScreenHeader,
  StudioGate,
  studioGate,
  T,
  type StudioGateAction,
} from '../../components/ui';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useToastStore } from '../../stores/toastStore';

type Props = NativeStackScreenProps<StudyStackParamList, 'PlayStudio'>;

export function PlayStudioScreen({ navigation, route }: Props) {
  const { courseId, courseLabel, studySetId } = route.params;
  const scope = scopeNoun(studySetId, courseId);
  const tabBarClearance = useTabBarClearance(16);
  const decks = useFlashcardStore((s) => s.decks);
  const flashcards = useFlashcardStore((s) => s.flashcards);
  const fetchFlashcards = useFlashcardStore((s) => s.fetchFlashcards);
  const showToast = useToastStore((s) => s.showToast);

  const courseDecks = useMemo(
    () => studioMaterials(decks, { studySetId, courseId }),
    [decks, courseId, studySetId]
  );
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
      showToast(playBlockerCopy('no_deck', scope) ?? playEmptyCopy(scope), 'info');
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

  /**
   * Where a gate button lands. Both targets stay INSIDE the container Play was
   * opened on — a set's gate opens that set's notes, not the global library —
   * because a deck is made by turning one of THIS set's notes into cards.
   */
  const runGateAction = (action: StudioGateAction) => {
    if (action.id === 'import_materials' && studySetId) {
      navigation.navigate('StudySetUpload', { studySetId, courseId, courseLabel });
      return;
    }
    if (studySetId) {
      navigation.navigate('StudySetLibrary', { studySetId, courseId, courseLabel, kind: 'notes' });
      return;
    }
    navigation.navigate('Library', { tab: 'notes' });
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
            <T.Body tone="secondary">{playTaglineCopy(scope)}</T.Body>
            {hubBlocker ? (
              // Was one grey sentence on bare ground (SF2 evidence §4.2).
              // `playBlockerCopy` still writes it, scope noun and all — it is
              // the only string that knows whether this is a set or a course —
              // and the card supplies the way out the sentence never had.
              <StudioGate
                feature="flashcards"
                icon="game-controller"
                content={studioGate({
                  studio: 'play',
                  reason: 'no_deck',
                  body: `${playBlockerCopy(hubBlocker, scope) ?? playEmptyCopy(scope)} Cards are made from a note, in the note’s studio.`,
                })}
                onAction={runGateAction}
              />
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
                          {blocked ? playBlockerCopy(blocked, scope) : mode.promise}
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
