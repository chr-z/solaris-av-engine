import { describe, it, expect } from 'vitest';
import {
  DRIVE_FOLDER_REGEX,
  DRIVE_FILE_REGEX,
  YOUTUBE_REGEX,
} from '../utils/regex';

describe('regex: URL parsing', () => {
  it('matches YouTube watch URLs and captures the 11-char id', () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const match = url.match(YOUTUBE_REGEX);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('dQw4w9WgXcQ');
  });

  it('matches YouTube short links (youtu.be) with optional scheme/www', () => {
    const match = 'youtu.be/dQw4w9WgXcQ'.match(YOUTUBE_REGEX);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('dQw4w9WgXcQ');
  });

  it('rejects URLs that are not YouTube videos', () => {
    expect('https://vimeo.com/123456'.match(YOUTUBE_REGEX)).toBeNull();
    expect('https://youtube.com/playlist?list=XYZ'.match(YOUTUBE_REGEX)).toBeNull();
  });

  it('extracts Drive file ids', () => {
    const match = 'https://drive.google.com/file/d/1AbC_de-Fgh123/view'.match(
      DRIVE_FILE_REGEX
    );
    expect(match).not.toBeNull();
    expect(match![1]).toBe('1AbC_de-Fgh123');
  });

  it('does not treat a folder link as a file link', () => {
    expect(
      'https://drive.google.com/drive/folders/1FolderId_XYZ'.match(DRIVE_FILE_REGEX)
    ).toBeNull();
  });

  it('extracts Drive folder ids', () => {
    const match =
      'https://drive.google.com/drive/folders/1FolderId_XYZ-123'.match(
        DRIVE_FOLDER_REGEX
      );
    expect(match).not.toBeNull();
    expect(match![1]).toBe('1FolderId_XYZ-123');
  });
});
