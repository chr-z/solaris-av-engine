// --- FORM COLUMN GROUPING ---
export const formSections: Record<string, string[]> = {
    'General Info': ['W.O.', 'INSTRUCTOR', 'OPERATOR', 'DATE', 'STUDIO', 'TYPE', 'KIT', 'MIC', 'EVENT', 'BACKGROUND', 'STREAMING', 'UNIFORM'],
    'Framing': ['Tilted/Crooked Camera', 'Excessive/Low Headroom', 'Poor Logo Framing', 'Visible Backdrop Limits', 'Subject Chroma Cutoff', 'Subject Too Close/Far', 'Camera Shake/Instability', 'Subject Off-Center', 'Subject Blocking Virtual TV'],
    'Lighting': ['Overexposed (Clipping)', 'Underexposed (Dark)', 'Uneven Lighting', 'Harsh Shadows', 'Incorrect Color Temp (Warm/Cold)', 'Flicker', 'Natural Light fluctuation', 'Glasses Reflection (Lighting)', 'Glasses Reflection (Monitor)', 'Background Reflection'],
    'Video Quality': ['Out of Focus', 'Low Resolution/Bitrate', 'Color Mismatch', 'Layer/Composition Error', 'A/V Desync', 'Exposure Hunting', 'Focus Hunting', 'Video Freezing/Stutter', 'Dropped Frames'],
    'Scenery & Assets': ['Non-Standard Assets', 'Incorrect Chroma BG', 'Asset Misaligned on Virtual TV', 'Chroma Key Failure', 'Non-Standard Scenery', 'Visual Pollution', 'Damaged Scenery'],
    'Audio': ['Audio Clipping (Peaking)', 'Low Volume', 'Distorted Audio', 'HVAC Noise', 'Environmental Noise', 'Microphone Friction Noise', 'Interference/Static', 'Excessive Reverb'],
    'Final Review': ['OPERATOR COMMENTS', 'INTERNAL NOTES', 'TECHNICAL FEEDBACK', 'NEEDS EDITING?', 'Responsibility', 'ANALYST', 'ANALYSIS TIME'],
    'Results': ['FRAMING SCORE', 'LIGHTING SCORE', 'VIDEO SCORE', 'SCENERY SCORE', 'AUDIO SCORE', 'FINAL SCORE'],
};

// Flatten all boolean fields into a single array and a Set for efficient lookup
const booleanSections = ['Framing', 'Lighting', 'Video Quality', 'Scenery & Assets', 'Audio'];
export const ALL_INCONFORMITY_OPTIONS = booleanSections.flatMap(section => formSections[section]);
export const allBooleanFields = new Set(ALL_INCONFORMITY_OPTIONS);

// Fields that hold calculated scores
export const resultFields = new Set(['FRAMING SCORE', 'LIGHTING SCORE', 'VIDEO SCORE', 'SCENERY SCORE', 'AUDIO SCORE']);

// Fields that toggle between 'YES' and 'NO'
export const simNaoFields = new Set(['NEEDS EDITING?', 'EVENT', 'UNIFORM']);

// Defines specific dropdown options for certain form fields
export const dropdownFields: Record<string, string[]> = {
  'Responsibility': ['GENERAL', 'QUALITY TEAM', 'OPERATOR', 'ENGINEERING'],
  'ANALYST': ['John Doe', 'Jane Smith', 'Guest Analyst', 'Lead Reviewer'],
  'EVENT': ['YES', 'NO'],
  'UNIFORM': ['YES', 'NO'],
  'NEEDS EDITING?': ['YES', 'NO'],
  'STUDIO': ['Studio A', 'Studio B', 'Studio C', 'Home Studio 1', 'Home Studio 2', 'Auditorium'],
};

// Map of non-conformities to their result categories for auto-calculation
export const inconformityToCategoryMap: Record<string, string> = {
    // FRAMING
    'Tilted/Crooked Camera': 'FRAMING SCORE',
    'Excessive/Low Headroom': 'FRAMING SCORE',
    'Poor Logo Framing': 'FRAMING SCORE',
    'Visible Backdrop Limits': 'FRAMING SCORE',
    'Subject Chroma Cutoff': 'FRAMING SCORE',
    'Subject Too Close/Far': 'FRAMING SCORE',
    'Camera Shake/Instability': 'FRAMING SCORE',
    'Subject Off-Center': 'FRAMING SCORE',
    'Subject Blocking Virtual TV': 'FRAMING SCORE',
    // LIGHTING
    'Overexposed (Clipping)': 'LIGHTING SCORE',
    'Underexposed (Dark)': 'LIGHTING SCORE',
    'Uneven Lighting': 'LIGHTING SCORE',
    'Harsh Shadows': 'LIGHTING SCORE',
    'Incorrect Color Temp (Warm/Cold)': 'LIGHTING SCORE',
    'Flicker': 'LIGHTING SCORE',
    'Natural Light fluctuation': 'LIGHTING SCORE',
    'Glasses Reflection (Lighting)': 'LIGHTING SCORE',
    'Glasses Reflection (Monitor)': 'LIGHTING SCORE',
    'Background Reflection': 'LIGHTING SCORE',
    // VIDEO QUALITY (Mapped to VIDEO SCORE)
    'Out of Focus': 'VIDEO SCORE',
    'Low Resolution/Bitrate': 'VIDEO SCORE',
    'Color Mismatch': 'VIDEO SCORE',
    'Layer/Composition Error': 'VIDEO SCORE',
    'A/V Desync': 'VIDEO SCORE',
    'Exposure Hunting': 'VIDEO SCORE',
    'Focus Hunting': 'VIDEO SCORE',
    'Video Freezing/Stutter': 'VIDEO SCORE',
    'Dropped Frames': 'VIDEO SCORE',
    // SCENERY
    'Non-Standard Assets': 'SCENERY SCORE',
    'Incorrect Chroma BG': 'SCENERY SCORE',
    'Asset Misaligned on Virtual TV': 'SCENERY SCORE',
    'Chroma Key Failure': 'SCENERY SCORE',
    'Non-Standard Scenery': 'SCENERY SCORE',
    'Visual Pollution': 'SCENERY SCORE',
    'Damaged Scenery': 'SCENERY SCORE',
    // AUDIO
    'Audio Clipping (Peaking)': 'AUDIO SCORE',
    'Low Volume': 'AUDIO SCORE',
    'Distorted Audio': 'AUDIO SCORE',
    'HVAC Noise': 'AUDIO SCORE',
    'Environmental Noise': 'AUDIO SCORE',
    'Microphone Friction Noise': 'AUDIO SCORE',
    'Interference/Static': 'AUDIO SCORE',
    'Excessive Reverb': 'AUDIO SCORE',
};

// Penalty scores for each non-conformity
export const inconformityScores: Record<string, number> = {
    // FRAMING
    'Tilted/Crooked Camera': 0.3,
    'Excessive/Low Headroom': 0.3,
    'Poor Logo Framing': 0.2,
    'Visible Backdrop Limits': 0.2,
    'Subject Chroma Cutoff': 0.1,
    'Subject Too Close/Far': 0.05,
    'Camera Shake/Instability': 0.05,
    'Subject Off-Center': 0.04,
    'Subject Blocking Virtual TV': 0.03,
    // LIGHTING
    'Overexposed (Clipping)': 0.3,
    'Underexposed (Dark)': 0.2,
    'Uneven Lighting': 0.1,
    'Harsh Shadows': 0.1,
    'Incorrect Color Temp (Warm/Cold)': 0.1,
    'Flicker': 0.03,
    'Natural Light fluctuation': 0.01,
    'Glasses Reflection (Lighting)': 0.01,
    'Glasses Reflection (Monitor)': 0.01,
    'Background Reflection': 0.01,
    // VIDEO
    'Out of Focus': 0.3,
    'Low Resolution/Bitrate': 0.2,
    'Color Mismatch': 0.15,
    'Layer/Composition Error': 0.15,
    'A/V Desync': 0.15,
    'Exposure Hunting': 0.08,
    'Focus Hunting': 0.08,
    'Video Freezing/Stutter': 0.05,
    'Dropped Frames': 0.04,
    // SCENERY
    'Non-Standard Assets': 0.02,
    'Incorrect Chroma BG': 0.2,
    'Asset Misaligned on Virtual TV': 0.2,
    'Chroma Key Failure': 0.2,
    'Non-Standard Scenery': 0.07,
    'Visual Pollution': 0.02,
    'Damaged Scenery': 0.01,
    // AUDIO
    'Audio Clipping (Peaking)': 0.3,
    'Low Volume': 0.3,
    'Distorted Audio': 0.15,
    'HVAC Noise': 0.05,
    'Environmental Noise': 0.04,
    'Microphone Friction Noise': 0.05,
    'Interference/Static': 0.02,
    'Excessive Reverb': 0.03,
};

export const categoryMaxScores: Record<string, number> = {
    'FRAMING SCORE': 1.27,
    'LIGHTING SCORE': 0.87,
    'VIDEO SCORE': 1.22,
    'SCENERY SCORE': 0.70,
    'AUDIO SCORE': 0.94,
};