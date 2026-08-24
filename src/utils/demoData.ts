import { RowData } from '../components/Analysis/AnalysisSheet';

// Simulated Headers matching constants.ts. v3 P13: the seven trailing
// columns are markable scoring rules (exact RULE_ALIASES headers) written by
// the analysis checklist — 'TRUE' marks feed both the ScoringEngine and the
// dashboard recurring-inconformity ranking.
export const DEMO_HEADERS = [
    "DATE", "W.O.", "EVENT", "STUDIO", "INSTRUCTOR", "OPERATOR", 
    "EDITOR", "ANALYST", "AUDIO SCORE", "VIDEO SCORE", "FRAMING SCORE", 
    "LIGHTING SCORE", "SCENERY SCORE", "FINAL SCORE", "OPERATOR COMMENTS", "FOLDER",
    "Audio Clipping (Peaking)", "Low Volume", "Uneven Lighting", "Harsh Shadows",
    "Focus Hunting", "Chroma Key Failure", "Asset Misaligned on Virtual TV"
];

// Helper to create a cell
const c = (value: string, link?: string) => ({ value, link });

// Checkbox helper: mirrors the analysis form ('TRUE'/'FALSE').
const b = (marked: boolean) => c(marked ? 'TRUE' : 'FALSE');

// v3 P13: stored category scores are ENGINE-DERIVED (seed, vigência 2025) —
// every row's markings reproduce its scores exactly, so the demo tells one
// coherent story across the workspace, the dashboards and the QC ranking.
export const DEMO_ROWS = [
    {
        rowIndex: 2,
        row: [
            c("2024-03-10"), 
            c("WO-2024-001"), 
            c("Python Masterclass"), 
            c("Studio A"), 
            c("Dr. Robert Smith"), 
            c("Op. Mike"), 
            c("Ed. Sarah"), 
            c("Guest Analyst"), 
            c("0.94"), c("1.22"), c("1.27"), c("0.87"), c("0.70"), 
            c("5.00"), 
            c("Perfect session. No issues found."),
            c("Drive Folder", "https://drive.google.com/drive/folders/demo-folder-1"),
            b(false), b(false), b(false), b(false),
            b(false), b(false), b(false)
        ]
    },
    {
        rowIndex: 3,
        row: [
            c("2024-03-11"), 
            c("WO-2024-042"), 
            c("UX Design Workshop"), 
            c("Home Studio 1"), 
            c("Jane Doe"), 
            c("Self"), 
            c("Ed. Tom"), 
            c("Guest Analyst"), 
            // ÁUDIO 0.94 − 0.30 (audio-estourando) = 0.64 → FINAL 4.55
            c("0.64"), c("1.22"), c("1.27"), c("0.87"), c("0.70"), 
            c("4.55"), 
            c("Audio clipping detected in second block. Microphone gain too high."),
            c("Drive Folder", "https://drive.google.com/drive/folders/demo-folder-2"),
            b(true), b(false), b(false), b(false),
            b(false), b(false), b(false)
        ]
    },
    {
        rowIndex: 4,
        row: [
            c("2024-03-12"), 
            c("WO-2024-088"), 
            c("Data Science Intro"), 
            c("Studio B"), 
            c("Alan Turing"), 
            c("Op. John"), 
            c("Ed. Emily"), 
            c("Guest Analyst"), 
            c("0.94"), c("1.22"), c("1.27"), 
            // ILUMINAÇÃO 0.87 − 0.10 (não uniforme) − 0.10 (sombras) = 0.67
            c("0.67"), c("0.70"), 
            c("4.80"), 
            c("Lighting was uneven. Key light failed mid-session."),
            c("Drive Folder", "https://drive.google.com/drive/folders/demo-folder-3"),
            b(false), b(false), b(true), b(true),
            b(false), b(false), b(false)
        ]
    },
    {
        rowIndex: 5,
        row: [
            c("2024-03-13"), 
            c("WO-2024-101"), 
            c("Business Analytics Live"), 
            c("Studio C"), 
            c("Dr. Alan Grant"), 
            c("Op. Rachel"), 
            c("Ed. Marcus"), 
            c("Guest Analyst"), 
            // ÁUDIO 0.94 − 0.30 (audio-estourando) = 0.64; OUTROS 1.22 − 0.08 (foco) = 1.14
            c("0.64"), c("1.14"), c("1.27"), c("0.87"), c("0.70"), 
            c("4.62"), 
            c("Presenter audio clipped during the live Q&A. Focus hunted during close-ups."),
            c("Drive Folder", "https://drive.google.com/drive/folders/demo-folder-4"),
            b(true), b(false), b(false), b(false),
            b(true), b(false), b(false)
        ]
    },
    {
        rowIndex: 6,
        row: [
            c("2024-03-14"), 
            c("WO-2024-115"), 
            c("Marketing Fundamentals Reel"), 
            c("Studio A"), 
            c("Prof. Ada Lovelace"), 
            c("Op. Sam"), 
            c("Ed. Nina"), 
            c("Guest Analyst"), 
            c("0.94"), c("1.22"), c("1.27"), c("0.87"), 
            // CENÁRIO 0.70 − 0.20 (falhas no chroma) − 0.20 (material na TV) = 0.30
            c("0.30"), 
            c("4.60"), 
            c("Chroma key artifacts around presenter edges. Slides overflowed the virtual TV area."),
            c("Drive Folder", "https://drive.google.com/drive/folders/demo-folder-5"),
            b(false), b(false), b(false), b(false),
            b(false), b(true), b(true)
        ]
    }
];

export interface RowWithSheetIndex {
    row: RowData;
    rowIndex: number;
}
