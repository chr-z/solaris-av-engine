import { DRIVE_FILE_REGEX, YOUTUBE_REGEX } from './regex';

/**
 * Extracts a unique video ID from a YouTube or Google Drive URL.
 * @param url The full URL of the video.
 * @returns The extracted video ID, or null if the URL is not recognized.
 */
export function getVideoIdFromUrl(url: string): string | null {
    if (!url) return null;

    const youtubeMatch = url.match(YOUTUBE_REGEX);
    if (youtubeMatch && youtubeMatch[1]) {
        return youtubeMatch[1];
    }

    const driveMatch = url.match(DRIVE_FILE_REGEX);
    if (driveMatch && driveMatch[1]) {
        return driveMatch[1];
    }
    
    return null;
}