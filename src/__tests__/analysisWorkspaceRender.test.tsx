// Regression for the Analysis Workspace render crash (P0).
//
// `osIdentifier` was declared after the acoustic hook that consumed it, so
// every workspace render threw:
//   ReferenceError: Cannot access 'osIdentifier' before initialization
// The build (`vite build`) never typechecked, so the defect shipped. This test
// mounts the real component — with and without a work-order value — so a
// re-introduced use-before-declaration fails fast. `npm run typecheck` (tsc
// TS2448/TS2454) is the same guard at the type level.

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '../i18n/I18nContext';
import { LicenseProvider } from '../licensing/LicenseContext';
import AnalysisWorkspace from '../components/Analysis/AnalysisWorkspace';

function makeProps(selectedRow: { value: string }[] | null) {
  return {
    selectedRow,
    headers: ['W.O.'],
    videoSrc: null,
    videoTitle: '',
    currentVideoId: null,
    isLocalVideo: false,
    videoChoices: [],
    isMediaLoading: false,
    isRowLoading: false,
    overlaySettings: {},
    setOverlaySettings: () => {},
    onLoadMedia: () => {},
    errorMessage: null,
    selectedOsIndex: 0,
    onSaveSuccess: () => {},
    onRetryLoad: () => {},
    isPickerOpen: false,
    pickerFolderId: null,
    onOpenPicker: () => {},
    onClosePicker: () => {},
    onFileFromPickerSelected: () => {},
    userProfile: null,
    onClose: () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function mount(selectedRow: { value: string }[] | null): HTMLElement {
  const { container } = render(
    <I18nProvider initialLocale="en">
      <LicenseProvider>
        <AnalysisWorkspace {...makeProps(selectedRow)} />
      </LicenseProvider>
    </I18nProvider>,
  );
  return container;
}

afterEach(() => cleanup());

describe('AnalysisWorkspace render', () => {
  it('mounts without throwing when a work order is selected', () => {
    const container = mount([{ value: 'OS-123' }]);
    expect(container.firstChild).not.toBeNull();
  });

  it('mounts without throwing when no row is selected', () => {
    const container = mount(null);
    expect(container.firstChild).not.toBeNull();
  });
});
