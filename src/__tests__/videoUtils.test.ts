import { describe, it, expect } from 'vitest';
import { getVideoIdFromUrl } from '../utils/videoUtils';

describe('videoUtils: id extraction', () => {
  it('extracts the id from a standard YouTube watch URL', () => {
    expect(getVideoIdFromUrl('https://www.youtube.com/watch?v=oHg5SJYRHA0')).toBe(
      'oHg5SJYRHA0'
    );
  });

  it('extracts the id from a youtu.be short link', () => {
    expect(getVideoIdFromUrl('https://youtu.be/oHg5SJYRHA0')).toBe(
      'oHg5SJYRHA0'
    );
  });

  it('extracts ids from embed and /v/ paths', () => {
    expect(getVideoIdFromUrl('https://youtube.com/embed/abc_-123XYZ')).toBe(
      'abc_-123XYZ'
    );
    expect(getVideoIdFromUrl('https://youtube.com/v/abc_-123XYZ')).toBe(
      'abc_-123XYZ'
    );
  });

  it('keeps trailing query params out of the YouTube id', () => {
    expect(
      getVideoIdFromUrl('https://youtube.com/watch?v=abc_-123XYZ&t=30s')
    ).toBe('abc_-123XYZ');
  });

  it('extracts a Google Drive file id', () => {
    expect(
      getVideoIdFromUrl('https://drive.google.com/file/d/1DriveFile_9/view')
    ).toBe('1DriveFile_9');
  });

  it('returns null for unsupported or empty URLs', () => {
    expect(getVideoIdFromUrl('https://vimeo.com/987654')).toBeNull();
    expect(getVideoIdFromUrl('')).toBeNull();
    expect(getVideoIdFromUrl('not a url at all')).toBeNull();
  });
});
