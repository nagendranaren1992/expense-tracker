import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  Platform,
} from 'react-native';
import { colors, spacing, radius, type } from '../theme';
import {
  startOfDay,
  isSameDay,
  isWithinRange,
  monthYearLabel,
  prettyDateYear,
} from '../utils/dates';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function buildMonthGrid(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  const startPad = first.getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * Modal calendar: tap From, then To, then Apply.
 * props: visible, from, to, onCancel, onApply({ from, to })
 */
export default function DateRangeModal({ visible, from, to, onCancel, onApply }) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [cursor, setCursor] = useState(() => startOfDay(from || new Date()));
  const [pickFrom, setPickFrom] = useState(from ? startOfDay(from) : null);
  const [pickTo, setPickTo] = useState(to ? startOfDay(to) : null);
  const [step, setStep] = useState('from'); // 'from' | 'to'

  useEffect(() => {
    if (!visible) return;
    setPickFrom(from ? startOfDay(from) : null);
    setPickTo(to ? startOfDay(to) : null);
    setCursor(startOfDay(from || to || new Date()));
    setStep(from && !to ? 'to' : 'from');
  }, [visible, from, to]);

  const cells = useMemo(() => buildMonthGrid(cursor), [cursor]);

  const shiftMonth = (delta) => {
    const n = new Date(cursor);
    n.setMonth(n.getMonth() + delta);
    setCursor(n);
  };

  const onDayPress = (day) => {
    if (!day) return;
    const d = startOfDay(day);
    if (d.getTime() > today.getTime()) return; // no future dates

    if (step === 'from' || !pickFrom) {
      setPickFrom(d);
      setPickTo(null);
      setStep('to');
      return;
    }

    // Picking "to"
    if (d.getTime() < pickFrom.getTime()) {
      setPickTo(pickFrom);
      setPickFrom(d);
    } else {
      setPickTo(d);
    }
    setStep('from');
  };

  const canApply = pickFrom && pickTo;

  const apply = () => {
    if (!canApply) return;
    let a = pickFrom;
    let b = pickTo;
    if (a > b) [a, b] = [b, a];
    onApply({ from: a, to: b });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation?.()}>
          <Text style={styles.title}>Select date range</Text>
          <Text style={styles.hint}>
            {step === 'to' && pickFrom
              ? `From ${prettyDateYear(pickFrom)} · tap end date`
              : 'Tap a start date, then an end date'}
          </Text>

          <View style={styles.rangeRow}>
            <View style={[styles.rangeBox, step === 'from' && styles.rangeBoxActive]}>
              <Text style={styles.rangeLabel}>FROM</Text>
              <Text style={styles.rangeValue}>
                {pickFrom ? prettyDateYear(pickFrom) : '—'}
              </Text>
            </View>
            <Text style={styles.rangeDash}>→</Text>
            <View style={[styles.rangeBox, step === 'to' && styles.rangeBoxActive]}>
              <Text style={styles.rangeLabel}>TO</Text>
              <Text style={styles.rangeValue}>
                {pickTo ? prettyDateYear(pickTo) : '—'}
              </Text>
            </View>
          </View>

          <View style={styles.monthNav}>
            <Pressable onPress={() => shiftMonth(-1)} style={styles.navBtn} hitSlop={8}>
              <Text style={styles.navText}>‹</Text>
            </Pressable>
            <Text style={styles.monthTitle}>{monthYearLabel(cursor)}</Text>
            <Pressable onPress={() => shiftMonth(1)} style={styles.navBtn} hitSlop={8}>
              <Text style={styles.navText}>›</Text>
            </Pressable>
          </View>

          <View style={styles.dowRow}>
            {DOW.map((d, i) => (
              <Text key={`${d}-${i}`} style={styles.dow}>
                {d}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((day, i) => {
              if (!day) {
                return <View key={`e-${i}`} style={styles.cell} />;
              }
              const disabled = day.getTime() > today.getTime();
              const selected =
                (pickFrom && isSameDay(day, pickFrom)) ||
                (pickTo && isSameDay(day, pickTo));
              const inRange =
                pickFrom &&
                pickTo &&
                isWithinRange(day, pickFrom, pickTo) &&
                !selected;
              const isToday = isSameDay(day, today);

              return (
                <Pressable
                  key={day.toISOString()}
                  onPress={() => onDayPress(day)}
                  disabled={disabled}
                  style={[
                    styles.cell,
                    inRange && styles.cellInRange,
                    selected && styles.cellSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayNum,
                      disabled && styles.dayDisabled,
                      selected && styles.daySelected,
                      isToday && !selected && styles.dayToday,
                    ]}
                  >
                    {day.getDate()}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.actions}>
            <Pressable style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.applyBtn, !canApply && styles.applyDisabled]}
              onPress={apply}
              disabled={!canApply}
            >
              <Text style={[styles.applyText, !canApply && styles.applyTextDisabled]}>
                Apply
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8,10,14,0.72)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
    ...Platform.select({
      web: { boxShadow: '0 12px 40px rgba(0,0,0,0.45)' },
      default: {},
    }),
  },
  title: { ...type.h1, color: colors.text, marginBottom: spacing.xs },
  hint: { ...type.small, color: colors.textFaint, marginBottom: spacing.lg },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  rangeBox: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rangeBoxActive: { borderColor: colors.mint },
  rangeLabel: { ...type.tiny, color: colors.textFaint, marginBottom: 2 },
  rangeValue: { ...type.h2, color: colors.text, fontSize: 15 },
  rangeDash: { ...type.body, color: colors.textDim },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navText: { fontSize: 22, color: colors.text, lineHeight: 26 },
  monthTitle: { ...type.h2, color: colors.text },
  dowRow: { flexDirection: 'row', marginBottom: spacing.xs },
  dow: {
    flex: 1,
    textAlign: 'center',
    ...type.tiny,
    color: colors.textFaint,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellInRange: { backgroundColor: 'rgba(59,217,166,0.12)' },
  cellSelected: {
    backgroundColor: colors.mint,
    borderRadius: radius.sm,
  },
  dayNum: { ...type.body, color: colors.text, fontWeight: '500' },
  dayDisabled: { color: colors.textFaint, opacity: 0.4 },
  daySelected: { color: '#06231A', fontWeight: '700' },
  dayToday: { color: colors.mint },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  cancelBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
  },
  cancelText: { ...type.h2, color: colors.textDim },
  applyBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.mint,
  },
  applyDisabled: { backgroundColor: colors.surfaceAlt },
  applyText: { ...type.h2, color: '#06231A' },
  applyTextDisabled: { color: colors.textFaint },
});
