import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  createCompareSlots,
  setSlotSource,
  canEnterCompareMode,
  clampCompareOffset,
  computeSyncCommand,
  SyncCommand,
  SyncMode,
  CompareLayout,
  nextCompareLayout,
} from '../utils/compareMode';

interface UseCompareModeOptions {
  /** Master gate — compare UI only exists while media is loaded. */
  hasMedia: boolean;
}

/**
 * S5.2: orchestrates the A/B compare mode.
 *
 * The leader (main player) publishes transport telemetry through
 * `publishTransport`; followers receive commands via the subscription
 * channel. The hot path is imperative (refs + callbacks) so timeupdate
 * traffic never triggers React re-renders — only mode/offset/layout
 * changes do.
 */
export function useCompareMode({ hasMedia }: UseCompareModeOptions) {
  const [isActive, setIsActive] = useState(false);
  const [slotBSource, setSlotBSource] = useState<string | null>(null);
  const [syncMode, setSyncMode] = useState<SyncMode>('locked');
  const [offsetSeconds, setOffsetSeconds] = useState(0);
  const [layout, setLayout] = useState<CompareLayout>('side-by-side');
  /** Bumped on every offset/sync change so panes re-apply sync while paused. */
  const [syncNonce, setSyncNonce] = useState(0);

  const syncModeRef = useRef<SyncMode>(syncMode);
  const offsetRef = useRef(offsetSeconds);
  const followerDurationRef = useRef<number | undefined>(undefined);
  const lastLeaderRef = useRef<{ time: number; playing: boolean }>({ time: 0, playing: false });
  const listenersRef = useRef(new Set<(command: SyncCommand) => void>());

  // Mirror state into refs inside effects (never during render) — the
  // publish path reads refs so it never goes stale behind closures.
  useEffect(() => { syncModeRef.current = syncMode; }, [syncMode]);
  useEffect(() => { offsetRef.current = offsetSeconds; }, [offsetSeconds]);

  // Leaving compare mode drops every follower subscription implicitly:
  // ComparePane unmounts and its effect cleanup unsubscribes.
  useEffect(() => {
    if (!isActive || hasMedia) return;
    setIsActive(false);
  }, [isActive, hasMedia]);

  const slots = useMemo(() => {
    const base = createCompareSlots();
    // Slot A mirrors the leader conceptually; only B holds user input.
    return [setSlotSource(base.A, 'leader'), setSlotSource(base.B, slotBSource)] as const;
  }, [slotBSource]);

  const canEnter = canEnterCompareMode(slots);

  const publishTransport = useCallback((state: { time: number; playing: boolean; duration: number }) => {
    lastLeaderRef.current = { time: state.time, playing: state.playing };
    followerDurationRef.current = state.duration > 0 ? state.duration : undefined;
    if (syncModeRef.current !== 'locked') return;

    const command = computeSyncCommand(state.time, state.playing, {
      offsetSeconds: offsetRef.current,
      followerDuration: followerDurationRef.current,
    });
    for (const listener of listenersRef.current) listener(command);
  }, []);

  const subscribeToLeader = useCallback((callback: (command: SyncCommand) => void) => {
    listenersRef.current.add(callback);
    return () => { listenersRef.current.delete(callback); };
  }, []);

  /** Re-broadcasts the latest leader state (used after offset edits). */
  const rebroadcast = useCallback(() => {
    if (syncModeRef.current !== 'locked') return;
    const { time, playing } = lastLeaderRef.current;
    const command = computeSyncCommand(time, playing, {
      offsetSeconds: offsetRef.current,
      followerDuration: followerDurationRef.current,
    });
    for (const listener of listenersRef.current) listener(command);
    setSyncNonce(n => n + 1);
  }, []);

  const toggleActive = useCallback(() => {
    setIsActive(active => !active);
  }, []);

  const changeOffset = useCallback((delta: number) => {
    setOffsetSeconds(prev => clampCompareOffset(prev + delta));
    rebroadcast();
  }, [rebroadcast]);

  const resetOffset = useCallback(() => {
    setOffsetSeconds(0);
    rebroadcast();
  }, [rebroadcast]);

  const toggleSyncMode = useCallback(() => {
    setSyncMode(mode => (mode === 'locked' ? 'free' : 'locked'));
    setSyncNonce(n => n + 1);
  }, []);

  const toggleLayout = useCallback(() => {
    setLayout(current => nextCompareLayout(current));
  }, []);

  return {
    isActive,
    canEnter,
    slotBSource,
    setSlotBSource,
    syncMode,
    offsetSeconds,
    layout,
    syncNonce,
    publishTransport,
    subscribeToLeader,
    toggleActive,
    changeOffset,
    resetOffset,
    toggleSyncMode,
    toggleLayout,
  };
}
