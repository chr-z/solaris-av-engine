import { useEffect, useRef } from 'react';
import {
  matchShortcut,
  isSaveCombo,
  ShortcutContext,
} from '../utils/shortcuts';

interface AnalystActions {
  /** Player controls — all optional so the layer can run list-only. */
  togglePlay?: () => void;
  seekBy?: (seconds: number) => void;
  seekToStart?: () => void;
  changeVolume?: (delta: number) => void;
  /** Workspace controls. */
  openTimeMarkers?: () => void;
  saveAnalysis?: () => void;
  /** S5.2: toggle the A/B compare split. */
  toggleCompare?: () => void;
  /** v3 P8: dashboards console actions (matched only on #/admin/dashboards). */
  nextDashSection?: () => void;
  prevDashSection?: () => void;
  exportDashCsv?: () => void;
  clearDashPeriod?: () => void;
  exitDashDrillDown?: () => void;
  /** v3 P9: printable QC report of the current dashboard view. */
  exportDashQcReport?: () => void;
  /** v3 P11: toggle the dashboard group A/B comparison bar. */
  dashToggleCompare?: () => void;
}

interface UseAnalystShortcutsOptions extends AnalystActions {
  /** Master switch (e.g. only when signed in). */
  enabled: boolean;
  /** Scope gating — a scope set to false never matches. */
  scopeEnabled?: Partial<Record<ShortcutContext, boolean>>;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

/**
 * S5.1: global keyboard layer for analysts.
 *
 * One window-level keydown listener dispatches analyst shortcuts
 * (K/J/L/,/↑/↓/+/-/T/Ctrl+S) with guards for form fields and modifiers,
 * so typing in the analysis sheet never fires player actions.
 * VideoPlayer keeps its own native keys (Space, ←/→, F, M).
 *
 * Callbacks and scope flags are mirrored into refs inside effects (never
 * during render), so the DOM listener binds once per `enabled` change.
 */
export function useAnalystShortcuts({
  enabled,
  scopeEnabled,
  ...actions
}: UseAnalystShortcutsOptions): void {
  const actionsRef = useRef<AnalystActions>({});
  const scopeRef = useRef(scopeEnabled);

  useEffect(() => {
    actionsRef.current = actions;
  });

  useEffect(() => {
    scopeRef.current = scopeEnabled;
  });

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isSaveCombo(event)) {
        if (scopeRef.current?.workspace === false) return;
        event.preventDefault();
        actionsRef.current.saveAnalysis?.();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // v3 P8: Escape inside the dashboards drill-down goes back one level
      // (checked before matchShortcut, which never matches Escape anyway).
      if (
        event.key === 'Escape' &&
        scopeRef.current?.dashboard === true &&
        !isEditableTarget(event.target)
      ) {
        actionsRef.current.exitDashDrillDown?.();
        return;
      }

      const def = matchShortcut(event, {
        isEditableTarget: isEditableTarget(event.target),
        scopeEnabled: scopeRef.current,
      });
      if (!def) return;

      const current = actionsRef.current;
      switch (def.id) {
        case 'playPause': current.togglePlay?.(); break;
        case 'jumpBack': current.seekBy?.(-10); break;
        case 'jumpForward': current.seekBy?.(30); break;
        case 'seekStart': current.seekToStart?.(); break;
        case 'frameBack': current.seekBy?.(-0.5); break;
        case 'frameForward': current.seekBy?.(0.5); break;
        case 'volumeUp': current.changeVolume?.(0.05); break;
        case 'volumeDown': current.changeVolume?.(-0.05); break;
        case 'markTime': current.openTimeMarkers?.(); break;
        case 'toggleCompare': current.toggleCompare?.(); break;
        case 'dashNextSection': current.nextDashSection?.(); break;
        case 'dashPrevSection': current.prevDashSection?.(); break;
        case 'dashExportCsv': current.exportDashCsv?.(); break;
        case 'dashClearPeriod': current.clearDashPeriod?.(); break;
        case 'dashExportQcReport': current.exportDashQcReport?.(); break;
        case 'dashToggleCompare': current.dashToggleCompare?.(); break;
        default: break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
