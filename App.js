import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { colors, spacing, radius, type } from './src/theme';
import {
  ensureSeeded,
  getTransactions,
  distinctAccounts,
  addTransactions,
  removeSampleData,
  clearTransactions,
  setActiveUser,
  migrateLegacyIfNeeded,
} from './src/data/storage';
import {
  onlySpends,
  filterByAccount,
  filterByPeriod,
  total,
  byCategory,
  byDay,
  previousPeriodTotal,
} from './src/utils/aggregate';
import { isSameDay, relativeDay, prettyRange } from './src/utils/dates';
import {
  isGmailConfigured,
  useGmailAuth,
  fetchAndParse,
  gmailSetupHint,
} from './src/services/gmail';
import {
  getSession,
  saveSession,
  clearSession,
  fetchGoogleProfile,
  isAuthError,
} from './src/services/auth';

import LoginScreen from './src/components/LoginScreen';
import SummaryCard from './src/components/SummaryCard';
import PeriodToggle from './src/components/PeriodToggle';
import DateRangeModal from './src/components/DateRangeModal';
import AccountFilter from './src/components/AccountFilter';
import WeeklyBarChart from './src/components/WeeklyBarChart';
import CategoryBreakdown from './src/components/CategoryBreakdown';
import TransactionList from './src/components/TransactionList';

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState(null);
  const [txs, setTxs] = useState([]);
  const [period, setPeriod] = useState('daily');
  const [customRange, setCustomRange] = useState(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [account, setAccount] = useState('all');
  const [selectedDay, setSelectedDay] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [status, setStatus] = useState('');
  const authIntentRef = useRef(null); // 'login' | 'sync'
  // expo-auth-session keeps the last success response; without these, Log out
  // clears session then the effect re-runs and signs the user straight back in.
  const acceptAuthRef = useRef(true);
  const lastHandledAuthRef = useRef(null);
  const sessionRef = useRef(null);
  const authEpochRef = useRef(0);

  const [gmailRequest, gmailResponse, promptGmail] = useGmailAuth();

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const load = useCallback(async () => {
    await ensureSeeded();
    const list = await getTransactions();
    setTxs(list);
  }, []);

  // Restore session on launch
  useEffect(() => {
    (async () => {
      try {
        const s = await getSession();
        if (s?.userId) {
          setActiveUser(s.userId);
          await migrateLegacyIfNeeded(s.userId);
          setSession(s);
          await ensureSeeded();
          const list = await getTransactions();
          setTxs(list);
        }
      } catch (e) {
        console.warn('session restore failed', e);
      } finally {
        setAuthReady(true);
      }
    })();
  }, []);

  const applySession = useCallback(async (profile, accessToken) => {
    const next = {
      userId: profile.userId,
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      accessToken: accessToken || undefined,
      signedInAt: new Date().toISOString(),
    };
    setActiveUser(next.userId);
    await migrateLegacyIfNeeded(next.userId);
    await saveSession(next);
    setSession(next);
    return next;
  }, []);

  const runSync = useCallback(
    async (accessToken, epoch) => {
      setStatus('Fetching your bank alerts…');
      const result = await fetchAndParse(accessToken, { days: 14 });
      if (epoch !== undefined && epoch !== authEpochRef.current) return;
      const parsed = result.transactions;
      setStatus('Cleaning up sample data…');
      await removeSampleData();
      if (epoch !== undefined && epoch !== authEpochRef.current) return;
      const added = await addTransactions(parsed);
      await load();
      if (epoch !== undefined && epoch !== authEpochRef.current) return;

      if (parsed.length > 0) {
        setStatus(
          `Scanned ${result.scanned} email${result.scanned === 1 ? '' : 's'}, ` +
            `loaded ${added} transaction${added === 1 ? '' : 's'}.`
        );
      } else if (result.scanned === 0) {
        setStatus(
          'No bank alert emails found in the last 14 days. Your bank may send from ' +
            "an address the app doesn't know yet — tell me the sender and I'll add it."
        );
      } else {
        setStatus(
          `Found ${result.scanned} email${result.scanned === 1 ? '' : 's'} but couldn't ` +
            "read any as transactions. Send me one alert email and I'll fix the parser."
        );
      }
    },
    [load]
  );

  useEffect(() => {
    const run = async () => {
      if (!gmailResponse) return;
      if (!acceptAuthRef.current) return;

      const authKey = [
        gmailResponse.type,
        gmailResponse.authentication?.accessToken || '',
        gmailResponse.error?.message || gmailResponse.errorCode || '',
      ].join('|');
      if (lastHandledAuthRef.current === authKey) return;
      lastHandledAuthRef.current = authKey;

      const epoch = authEpochRef.current;

      if (gmailResponse.type === 'success') {
        const token = gmailResponse.authentication?.accessToken;
        if (!token) {
          setStatus('Signed in, but no access token came back.');
          setSyncing(false);
          authIntentRef.current = null;
          return;
        }
        try {
          setStatus('Signing you in…');
          const profile = await fetchGoogleProfile(token);
          if (epoch !== authEpochRef.current || !acceptAuthRef.current) return;
          const currentUserId = sessionRef.current?.userId;
          if (currentUserId && profile.userId !== currentUserId) {
            setStatus(
              'That Google account is different from the one signed in. Log out first to switch.'
            );
            return;
          }
          await applySession(profile, token);
          if (epoch !== authEpochRef.current || !acceptAuthRef.current) return;

          const intent = authIntentRef.current || 'sync';
          if (intent === 'login') {
            setStatus('Signed in. Syncing your bank alerts…');
          }
          await runSync(token, epoch);
        } catch (e) {
          if (epoch === authEpochRef.current && acceptAuthRef.current) {
            setStatus('Sign-in / sync failed: ' + e.message);
          }
        } finally {
          if (epoch === authEpochRef.current) {
            setSyncing(false);
            authIntentRef.current = null;
          }
        }
      } else if (gmailResponse.type === 'error') {
        setStatus('Google sign-in error: ' + (gmailResponse.error?.message || 'unknown'));
        setSyncing(false);
        authIntentRef.current = null;
      } else if (
        gmailResponse.type === 'dismiss' ||
        gmailResponse.type === 'cancel'
      ) {
        setStatus('Sign-in cancelled.');
        setSyncing(false);
        authIntentRef.current = null;
      }
    };
    run();
  }, [gmailResponse, applySession, runSync]);

  const startGoogle = useCallback(
    async (intent) => {
      if (!isGmailConfigured()) {
        setStatus(gmailSetupHint());
        return;
      }
      acceptAuthRef.current = true;
      lastHandledAuthRef.current = null;
      authIntentRef.current = intent;
      setSyncing(true);
      setStatus(intent === 'login' ? 'Opening Google sign-in…' : 'Opening Google…');
      await promptGmail();
    },
    [promptGmail]
  );

  const onSignIn = useCallback(() => startGoogle('login'), [startGoogle]);

  const onLogout = useCallback(async () => {
    // Ignore sticky OAuth success + any in-flight sync so we stay on login.
    acceptAuthRef.current = false;
    authEpochRef.current += 1;
    authIntentRef.current = null;
    if (gmailResponse) {
      lastHandledAuthRef.current = [
        gmailResponse.type,
        gmailResponse.authentication?.accessToken || '',
        gmailResponse.error?.message || gmailResponse.errorCode || '',
      ].join('|');
    }
    setSyncing(false);
    await clearSession();
    setActiveUser(null);
    setSession(null);
    setTxs([]);
    setAccount('all');
    setStatus('');
    setConfirmReset(false);
  }, [gmailResponse]);

  const onRefresh = useCallback(async () => {
    if (!session) return;
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load, session]);

  const onSync = useCallback(async () => {
    if (!isGmailConfigured()) {
      setStatus(gmailSetupHint());
      return;
    }
    if (session?.accessToken) {
      setSyncing(true);
      try {
        await runSync(session.accessToken);
      } catch (e) {
        if (isAuthError(e)) {
          setStatus('Session expired — sign in again to sync…');
          await startGoogle('sync');
          return;
        }
        setStatus('Sync failed: ' + e.message);
      } finally {
        setSyncing(false);
      }
      return;
    }
    await startGoogle('sync');
  }, [session, runSync, startGoogle]);

  const onReset = useCallback(async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setStatus('Tap "Confirm?" to clear all stored transactions. You can reload them with Sync.');
      setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    await clearTransactions();
    setConfirmReset(false);
    await load();
    setStatus('Cleared all stored transactions. Tap Sync to reload from Gmail.');
  }, [confirmReset, load]);

  const accounts = useMemo(() => distinctAccounts(txs), [txs]);

  const scopedSpends = useMemo(
    () => filterByAccount(onlySpends(txs), account),
    [txs, account]
  );

  const periodSpends = useMemo(
    () => filterByPeriod(scopedSpends, period, new Date(), customRange),
    [scopedSpends, period, customRange]
  );

  const showDayChart =
    period === 'weekly' ||
    (period === 'custom' && customRange?.from && customRange?.to);

  const focusSpends = useMemo(() => {
    if (showDayChart && selectedDay) {
      return scopedSpends.filter((t) => isSameDay(t.date, selectedDay));
    }
    return periodSpends;
  }, [showDayChart, selectedDay, scopedSpends, periodSpends]);

  const periodTotal = useMemo(() => total(periodSpends), [periodSpends]);
  const prevTotal = useMemo(
    () =>
      previousPeriodTotal(
        filterByAccount(txs, account),
        period,
        new Date(),
        customRange
      ),
    [txs, account, period, customRange]
  );
  const categories = useMemo(() => byCategory(focusSpends), [focusSpends]);
  const weekData = useMemo(
    () =>
      byDay(scopedSpends, new Date(), period === 'custom' ? customRange : null),
    [scopedSpends, period, customRange]
  );
  const topCategory = categories[0];

  const listTxs = useMemo(() => {
    const scoped = filterByAccount(txs, account);
    if (period === 'daily') return scoped.filter((t) => isSameDay(t.date, new Date()));
    if (selectedDay) return scoped.filter((t) => isSameDay(t.date, selectedDay));
    return filterByPeriod(scoped, period, new Date(), customRange);
  }, [txs, account, period, selectedDay, customRange]);

  const handleSelectDay = (date) => {
    setSelectedDay((cur) => (cur && isSameDay(cur, date) ? null : date));
  };

  const summaryLabel =
    period === 'daily'
      ? "Today's spend"
      : period === 'custom' && customRange
        ? `Spend · ${prettyRange(customRange.from, customRange.to)}`
        : "This week's spend";

  const chartTitle =
    period === 'custom' && customRange
      ? prettyRange(customRange.from, customRange.to)
      : 'Last 7 days';

  const focusLabel =
    showDayChart && selectedDay ? relativeDay(selectedDay) : null;

  if (!authReady) {
    return (
      <View style={[styles.root, styles.centered]}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={colors.mint} />
      </View>
    );
  }

  if (!session) {
    return (
      <LoginScreen
        onSignIn={onSignIn}
        loading={syncing}
        status={status}
        setupHint={!isGmailConfigured() ? gmailSetupHint() : null}
      />
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.mint}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.brand}>Spends</Text>
            <Text style={styles.sub} numberOfLines={1}>
              {session.email}
            </Text>
          </View>
          <View style={styles.headerBtns}>
            <Pressable style={styles.resetBtn} onPress={onLogout}>
              <Text style={styles.resetText}>Log out</Text>
            </Pressable>
            <Pressable
              style={[styles.resetBtn, confirmReset && styles.resetBtnArmed]}
              onPress={onReset}
              disabled={syncing}
            >
              <Text style={[styles.resetText, confirmReset && styles.resetTextArmed]}>
                {confirmReset ? 'Confirm?' : 'Reset'}
              </Text>
            </Pressable>
            <Pressable style={styles.syncBtn} onPress={onSync} disabled={syncing}>
              {syncing ? (
                <ActivityIndicator size="small" color={colors.mint} />
              ) : (
                <Text style={styles.syncText}>⟳ Sync</Text>
              )}
            </Pressable>
          </View>
        </View>

        {txs.length === 0 && !syncing ? (
          <Text style={styles.emptyHint}>
            No transactions yet. Tap Sync to pull bank alerts from your Gmail.
          </Text>
        ) : null}

        <PeriodToggle
          value={period}
          range={customRange}
          onChange={(p) => {
            setPeriod(p);
            setSelectedDay(null);
          }}
          onPressCustom={() => setRangeOpen(true)}
        />

        <DateRangeModal
          visible={rangeOpen}
          from={customRange?.from}
          to={customRange?.to}
          onCancel={() => setRangeOpen(false)}
          onApply={({ from, to }) => {
            setCustomRange({ from, to });
            setPeriod('custom');
            setSelectedDay(null);
            setRangeOpen(false);
          }}
        />

        <View style={{ height: spacing.md }} />
        <AccountFilter accounts={accounts} value={account} onChange={setAccount} />

        <View style={{ height: spacing.lg }} />
        <SummaryCard
          label={summaryLabel}
          amount={periodTotal}
          previous={prevTotal}
          count={periodSpends.length}
          topCategory={topCategory}
        />

        {showDayChart && (
          <>
            <View style={{ height: spacing.lg }} />
            <WeeklyBarChart
              data={weekData}
              title={chartTitle}
              selectedDate={selectedDay}
              onSelectDay={handleSelectDay}
            />
          </>
        )}

        {focusLabel && (
          <Text style={styles.focusHint}>
            Showing {focusLabel} · tap the bar again to see the full range
          </Text>
        )}

        <View style={{ height: spacing.lg }} />
        <CategoryBreakdown data={categories} total={total(focusSpends)} />

        <View style={{ height: spacing.lg }} />
        <TransactionList transactions={listTxs} />

        {!!status && <Text style={styles.status}>{status}</Text>}
        {isGmailConfigured() && gmailRequest?.redirectUri ? (
          <Text style={styles.status}>
            If Google shows a "redirect_uri_mismatch", add this exact URI in your
            OAuth client:{'\n'}
            {gmailRequest.redirectUri}
          </Text>
        ) : null}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>

      {syncing && (
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <ActivityIndicator size="large" color={colors.mint} />
            <Text style={styles.overlayText}>
              {status || 'Syncing your transactions…'}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'web' ? spacing.xl : 56,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  headerLeft: { flex: 1, minWidth: 0, paddingRight: spacing.sm },
  brand: { ...type.h1, color: colors.text },
  sub: { ...type.small, color: colors.textFaint, marginTop: 2 },
  emptyHint: {
    ...type.small,
    color: colors.textDim,
    marginBottom: spacing.lg,
    lineHeight: 18,
  },
  syncBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  syncText: { ...type.small, color: colors.mint, fontWeight: '600' },
  headerBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    maxWidth: '58%',
  },
  resetBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  resetBtnArmed: {
    borderColor: colors.coral,
    backgroundColor: 'rgba(255,107,107,0.12)',
  },
  resetText: { ...type.small, color: colors.textDim, fontWeight: '600' },
  resetTextArmed: { color: colors.coral },
  focusHint: {
    ...type.small,
    color: colors.textDim,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  status: {
    ...type.small,
    color: colors.textFaint,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(8,10,14,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 240,
    maxWidth: 340,
  },
  overlayText: {
    ...type.body,
    color: colors.text,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
});
