export type DockId = 'rgbParade' | 'waveform' | 'spectrogram';

/**
 * Configuration for video overlays used in technical analysis.
 */
export interface OverlaySettings {
  type: 'none' | 'grid' | 'onsite' | 'homestudio' | 'crosshair';
  opacity: number;
  crosshairPosition: { x: number; y: number };
}

export interface VideoAnalysisData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface AnalysisData {
  video: VideoAnalysisData | null;
  volume: number;
  frequency: Uint8Array | null;
}

export type VideoChoice = {
  url: string;
  type: 'youtube' | 'driveFile' | 'driveFolder';
  sourceName: string;
};

export interface UserProfile {
  id: string;
  name: string;
  givenName: string;
  picture: string;
  email: string;
}


export interface TimestampAnalyst {
    id: string;
    name: string;
    givenName: string;
    picture: string;
  }
  
  export interface Timestamp {
    id: string;
    time: number;
    comment: string;
    analyst: TimestampAnalyst;
    createdAt: number;
    fileId: string;
    fileName: string; 
  }
  
  export type DriveFile = {
    id: string;
    name: string;
    mimeType: string;
    url: string;
  };
  
  export interface RowWithSheetIndex {
    rowIndex: number;
    row: RowData;
  }
  
  // Represents a single cell in the Google Sheet
  export interface CellData {
      value: string;
      link?: string;
  }
  
  // The raw array of cells returned by the Sheets API
  export type RowData = CellData[];