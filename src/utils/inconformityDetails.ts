export interface InconformityDetails {
  type: string;
  definition: string;
  analystAction: string;
  grade: number;
  score2024: string; 
  score2025: string;
}

export const inconformityDetailsMap: Record<string, InconformityDetails> = {
  'Tilted/Crooked Camera': {
    type: 'FRAMING',
    definition: 'Camera axis is rotated relative to the horizon or vertical lines in the background.',
    analystAction: 'Mark if the tilt exceeds accepted tolerance relative to background logos or lines.',
    grade: 3,
    score2024: '0.2',
    score2025: '0.3'
  },
  'Excessive/Low Headroom': {
    type: 'FRAMING',
    definition: 'Space between the subject\'s head and the top of the frame is incorrect (too much empty space or cut off).',
    analystAction: 'Check first 20 seconds. Mark if headroom deviates significantly from the studio guidelines.',
    grade: 3,
    score2024: '0.2',
    score2025: '0.3'
  },
  'Poor Logo Framing': {
    type: 'FRAMING',
    definition: 'Background logo is cut off, off-center, or blocked improperly.',
    analystAction: 'Mark if logo visibility is compromised in the main frontal shot.',
    grade: 3,
    score2024: '0.15',
    score2025: '0.2'
  },
  'Overexposed (Clipping)': {
    type: 'LIGHTING',
    definition: 'Loss of visual information in highlights (whites are blown out). Visible on Waveform > 100 IRE.',
    analystAction: 'Mark immediately if skin tones or key elements are clipping.',
    grade: 3,
    score2024: '0.15',
    score2025: '0.3'
  },
  'Underexposed (Dark)': {
    type: 'LIGHTING',
    definition: 'Image is too dark, crushing blacks or muddying skin tones. Visible on Waveform.',
    analystAction: 'Mark if subject face luminance is consistently below 50 IRE.',
    grade: 3,
    score2024: '0.05',
    score2025: '0.2'
  },
  'Out of Focus': {
    type: 'VIDEO',
    definition: 'Subject (instructor) is not sharp. Focus plane is incorrect.',
    analystAction: 'Mark immediately.',
    grade: 3,
    score2024: '0.25',
    score2025: '0.3'
  },
  'A/V Desync': {
    type: 'VIDEO',
    definition: 'Lip movement does not match audio track.',
    analystAction: 'Verify in reduced speed. Mark if sync drift is noticeable.',
    grade: 2,
    score2024: '0.2',
    score2025: '0.15'
  },
  'Chroma Key Failure': {
    type: 'SCENERY',
    definition: 'Green spill, transparency issues, or jagged edges on the key.',
    analystAction: 'Mark if artifacts are visible around the subject.',
    grade: 3,
    score2024: '0.1',
    score2025: '0.2'
  },
  'Audio Clipping (Peaking)': {
    type: 'AUDIO',
    definition: 'Audio signal exceeds 0dBFS causing digital distortion.',
    analystAction: 'Mark if distortion is audible or red-lining on VU meter.',
    grade: 3,
    score2024: '0.2',
    score2025: '0.3'
  },
  'Low Volume': {
    type: 'AUDIO',
    definition: 'Average levels are too low (e.g., below -20dBFS) making speech hard to hear.',
    analystAction: 'Mark if levels are consistently low requiring user to boost volume excessively.',
    grade: 3,
    score2024: '0.2',
    score2025: '0.3'
  }
};