import { RowData } from '../components/AnalysisSheet';

// Simulated Headers matching constants.ts
export const DEMO_HEADERS = [
    "DATE", "W.O.", "EVENT", "STUDIO", "INSTRUCTOR", "OPERATOR", 
    "EDITOR", "ANALYST", "AUDIO SCORE", "VIDEO SCORE", "FRAMING SCORE", 
    "LIGHTING SCORE", "SCENERY SCORE", "FINAL SCORE", "OPERATOR COMMENTS", "FOLDER"
];

// Helper to create a cell
const c = (value: string, link?: string) => ({ value, link });

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
            c("Drive Folder", "https://drive.google.com/drive/folders/demo-folder-1")
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
            c("0.64"), c("1.22"), c("0.90"), c("0.87"), c("0.70"), 
            c("4.33"), 
            c("Audio clipping detected in second block. Microphone gain too high."),
            c("Drive Folder", "https://drive.google.com/drive/folders/demo-folder-2")
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
            c("0.94"), c("0.92"), c("1.27"), c("0.57"), c("0.70"), 
            c("4.40"), 
            c("Lighting was uneven. Key light failed mid-session."),
            c("Drive Folder", "https://drive.google.com/drive/folders/demo-folder-3")
        ]
    }
];

export interface RowWithSheetIndex {
    row: RowData;
    rowIndex: number;
}