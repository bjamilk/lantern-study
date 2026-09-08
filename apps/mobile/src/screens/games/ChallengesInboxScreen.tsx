import React, { useCallback, useEffect, useRef, useState } from 'react';

import {

  View,

  Text,

  StyleSheet,

  SectionList,

  TouchableOpacity,

  ActivityIndicator,

} from 'react-native';

import { Screen, useScreenBottomPadding } from '../../components/layout';

import { useNavigation, useFocusEffect } from '@react-navigation/native';


import type { GroupChallenge } from '@lantern/shared/types';
import { pluralize } from '@lantern/shared/utils/plural';

import { useTheme } from '../../theme';
import { appAlert } from '../../components/ui/appDialog';

import { useAuthStore } from '../../stores/authStore';
import { buildCurrentGameUser } from '../../utils/currentGameUser';

import { useGameStore } from '../../stores/gameStore';

import {

  fetchChallenges,

  acceptChallenge,

  declineChallenge,

} from '../../services/challenges';
import { AppIcon } from '../../components/ui/AppIcon';



export default function ChallengesInboxScreen() {

  const { colors } = useTheme();

  const navigation = useNavigation<any>();

  const { user, profileName } = useAuthStore();

  const { startChallengePlay } = useGameStore();

  const [challenges, setChallenges] = useState<GroupChallenge[]>([]);

  const [loading, setLoading] = useState(true);

  const [actionId, setActionId] = useState<string | null>(null);



  // This screen polls every 10s while focused. Logging the raw error on every
  // tick filled the console with bare "[TypeError: Network request failed]"
  // lines that named neither the request nor the screen, so a real API problem
  // was indistinguishable from a dropped connection. Log with context, and only
  // when the failure changes — repeats of the same error stay quiet.
  const lastLoadErrorRef = useRef<string | null>(null);

  const load = useCallback(async (silent = false) => {

    if (!silent) setLoading(true);

    try {

      setChallenges(await fetchChallenges());

      lastLoadErrorRef.current = null;

    } catch (e) {

      const message = e instanceof Error ? e.message : String(e);

      if (lastLoadErrorRef.current !== message) {

        lastLoadErrorRef.current = message;

        console.warn('[ChallengesInbox] fetchChallenges failed:', message);

      }

    } finally {

      if (!silent) setLoading(false);

    }

  }, []);



  useEffect(() => {

    void load();

  }, [load]);



  useFocusEffect(

    useCallback(() => {

      const interval = setInterval(() => void load(true), 10000);

      return () => clearInterval(interval);

    }, [load])

  );



  const currentUser = user ? buildCurrentGameUser(user, profileName) : null;



  const playChallenge = async (challengeId: string) => {

    if (!currentUser) return;

    try {

      const session = await startChallengePlay(challengeId, currentUser);

      if (session.isComplete || session.awaitingOpponent) {

        navigation.navigate('GameResult', { session, currentUser });

      } else {

        navigation.navigate('GameScreen', {});

      }

    } catch (e: any) {

      appAlert('Error', e.message || 'Could not start challenge');

    }

  };



  const pendingIncoming = challenges.filter(

    c => c.status === 'pending' && c.opponentId === user?.id

  );

  const pendingOutgoing = challenges.filter(

    c => c.status === 'pending' && c.challengerId === user?.id

  );

  const active = challenges.filter(c => c.status === 'accepted');

  const recent = challenges.filter(c => ['completed', 'declined', 'expired'].includes(c.status));



  const sections = [

    { title: 'Incoming', data: pendingIncoming },

    { title: 'Sent — waiting for response', data: pendingOutgoing },

    { title: 'Active', data: active },

    { title: 'Recent', data: recent.slice(0, 10) },

  ].filter(s => s.data.length > 0);



  const renderItem = ({ item }: { item: GroupChallenge }) => {

    const isOpponent = item.opponentId === user?.id;

    const otherName = isOpponent ? item.challenger?.name : item.opponent?.name;

    const busy = actionId === item.id;



    return (

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

        <Text style={[styles.title, { color: colors.text }]}>

          {isOpponent ? `${otherName} challenged you` : `You challenged ${otherName}`}

        </Text>

        <Text style={[styles.meta, { color: colors.textSecondary }]}>

          {item.status} · {pluralize(item.config.numberOfQuestions, 'question')}

        </Text>

        <View style={styles.actions}>

          {item.status === 'pending' && isOpponent && (

            <>

              <TouchableOpacity

                disabled={busy}

                style={[styles.btn, styles.accept]}

                onPress={async () => {

                  setActionId(item.id);

                  try {

                    await acceptChallenge(item.id);

                    await load(true);

                  } finally {

                    setActionId(null);

                  }

                }}

              >

                <Text style={styles.btnText}>Accept</Text>

              </TouchableOpacity>

              <TouchableOpacity

                disabled={busy}

                style={[styles.btn, styles.decline]}

                onPress={async () => {

                  setActionId(item.id);

                  try {

                    await declineChallenge(item.id);

                    await load(true);

                  } finally {

                    setActionId(null);

                  }

                }}

              >

                <Text style={[styles.btnText, { color: colors.text }]}>Decline</Text>

              </TouchableOpacity>

            </>

          )}

          {item.status === 'pending' && !isOpponent && (

            <Text style={{ color: colors.textSecondary, fontStyle: 'italic' }}>

              Waiting for {otherName} to accept…

            </Text>

          )}

          {item.status === 'accepted' && !item.myParticipant?.finishedAt && (

            <TouchableOpacity style={[styles.btn, styles.accept]} onPress={() => playChallenge(item.id)}>

              <Text style={styles.btnText}>Play Duel</Text>

            </TouchableOpacity>

          )}

          {item.status === 'accepted' && item.myParticipant?.finishedAt && (

            <Text style={{ color: colors.textSecondary, fontStyle: 'italic' }}>Waiting for opponent…</Text>

          )}

          {item.status === 'completed' && (

            <TouchableOpacity style={[styles.btn, styles.accept]} onPress={() => playChallenge(item.id)}>

              <Text style={styles.btnText}>View Results</Text>

            </TouchableOpacity>

          )}

        </View>

      </View>

    );

  };



  // The bottom tab bar is an absolute overlay on this route, so a bare
  // `padding: 16` left the last challenge row's Accept/Decline buttons under
  // it. The container also used to take the bottom inset via default `edges`,
  // which is the wrong quantity — the bar is ~102-118px, not ~20-48px.
  const listPadding = useScreenBottomPadding();

  return (

    <Screen edges={['top']} bottom="none" className="flex-1" style={{ backgroundColor: colors.background }}>

      <View style={styles.header}>

        <TouchableOpacity onPress={() => navigation.goBack()}>

          <AppIcon name="arrow-back" size={24} color={colors.text} />

        </TouchableOpacity>

        <Text style={[styles.headerTitle, { color: colors.text }]}>Duel Challenges</Text>

        <View style={{ width: 24 }} />

      </View>

      {loading ? (

        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primaryText} />

      ) : (

        <SectionList

          sections={sections}

          keyExtractor={item => item.id}

          renderItem={renderItem}

          renderSectionHeader={({ section: { title } }) => (

            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{title}</Text>

          )}

          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: listPadding }}

          ListEmptyComponent={

            <Text style={{ textAlign: 'center', color: colors.textSecondary, marginTop: 40 }}>

              No duels yet. Challenge a group member from group info.

            </Text>

          }

        />

      )}

    </Screen>

  );

}



const styles = StyleSheet.create({

  header: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',

    padding: 16,

  },

  headerTitle: { fontSize: 18, fontWeight: '700' },

  sectionTitle: {

    fontSize: 13,

    fontWeight: '600',

    textTransform: 'uppercase',

    letterSpacing: 0.5,

    marginBottom: 8,

    marginTop: 4,

  },

  card: {

    borderRadius: 12,

    borderWidth: 1,

    padding: 14,

    marginBottom: 8,

  },

  title: { fontSize: 16, fontWeight: '600' },

  meta: { fontSize: 12, marginTop: 4, textTransform: 'capitalize' },

  actions: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },

  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },

  accept: { backgroundColor: '#ef4444' },

  decline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#ccc' },

  btnText: { color: '#fff', fontWeight: '600' },

});


