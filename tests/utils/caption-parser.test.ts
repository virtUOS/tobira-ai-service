import { formatDuration, segmentCaptions } from '../../src/utils/caption-parser';
import type { CaptionCue } from '../../src/utils/caption-parser';

// Helper to build a CaptionCue without needing the full parser
const cue = (startTime: number, endTime: number, text: string): CaptionCue => ({
  startTime,
  endTime,
  text,
});

describe('formatDuration', () => {
  it('formats zero as "0s"', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('formats milliseconds into seconds', () => {
    expect(formatDuration(30000)).toBe('30s');
    expect(formatDuration(1000)).toBe('1s');
  });

  it('formats exactly 60 seconds as "1m 0s"', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(150000)).toBe('2m 30s');
  });

  it('formats exactly 1 hour as "1h 0m"', () => {
    expect(formatDuration(3600000)).toBe('1h 0m');
  });

  it('formats hours and minutes (seconds are dropped at hour scale)', () => {
    expect(formatDuration(3660000)).toBe('1h 1m');
    expect(formatDuration(7320000)).toBe('2h 2m');
  });
});

describe('segmentCaptions', () => {
  it('returns an empty array for no cues', () => {
    expect(segmentCaptions([])).toEqual([]);
  });

  it('groups all cues within the same window into one segment', () => {
    const cues = [
      cue(0, 5000, 'Hello'),
      cue(5000, 10000, 'world'),
    ];
    const result = segmentCaptions(cues, 300000);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Hello world');
    expect(result[0].startTime).toBe(0);
    expect(result[0].endTime).toBe(10000);
  });

  it('splits cues into two segments when threshold is exceeded', () => {
    const cues = [
      cue(0, 5000, 'First'),
      cue(300001, 305000, 'Second'),
    ];
    const result = segmentCaptions(cues, 300000);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('First');
    expect(result[1].text).toBe('Second');
  });

  it('respects a custom segment duration', () => {
    const cues = [
      cue(0, 1000, 'A'),
      cue(10001, 11000, 'B'),
      cue(20002, 21000, 'C'),
    ];
    const result = segmentCaptions(cues, 10000); // 10-second segments
    expect(result).toHaveLength(3);
  });

  it('puts a cue that starts exactly at the boundary into a NEW segment', () => {
    const cues = [
      cue(0, 5000, 'Boundary start'),
      cue(300000, 305000, 'Boundary end'),
    ];
    // segmentCaptions uses >=, so 300000 >= 0 + 300000 triggers a new segment
    const result = segmentCaptions(cues, 300000);
    expect(result).toHaveLength(2);
  });

  it('handles a single cue', () => {
    const result = segmentCaptions([cue(0, 5000, 'Solo')], 300000);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Solo');
  });
});
