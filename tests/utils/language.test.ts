import { normalizeLanguageCode, getLanguageFallbacks } from '../../src/utils/language';

describe('normalizeLanguageCode', () => {
  it('lowercases a plain language code', () => {
    expect(normalizeLanguageCode('EN')).toBe('en');
  });

  it('lowercases a regional code', () => {
    expect(normalizeLanguageCode('DE-DE')).toBe('de-de');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeLanguageCode('  en-us  ')).toBe('en-us');
  });

  it('is idempotent on already-normalized codes', () => {
    expect(normalizeLanguageCode('de-de')).toBe('de-de');
    expect(normalizeLanguageCode('en')).toBe('en');
  });

  it('preserves hyphenated regional codes', () => {
    expect(normalizeLanguageCode('ZH-HANS')).toBe('zh-hans');
  });

  it('throws on empty string', () => {
    expect(() => normalizeLanguageCode('')).toThrow('Language code is required');
  });

  it('throws on whitespace-only string', () => {
    expect(() => normalizeLanguageCode('   ')).toThrow('Language code is required');
  });

  it('throws on undefined', () => {
    expect(() => normalizeLanguageCode(undefined as any)).toThrow('Language code is required');
  });
});

describe('getLanguageFallbacks', () => {
  it('returns [regional, base, en] for a non-english regional code', () => {
    expect(getLanguageFallbacks('de-de')).toEqual(['de-de', 'de', 'en']);
  });

  it('does not duplicate en when base language is en', () => {
    expect(getLanguageFallbacks('en-us')).toEqual(['en-us', 'en']);
  });

  it('returns only [en] when input is en', () => {
    expect(getLanguageFallbacks('en')).toEqual(['en']);
  });

  it('normalizes input before building fallbacks', () => {
    expect(getLanguageFallbacks('FR-FR')).toEqual(['fr-fr', 'fr', 'en']);
  });

  it('returns [base, en] for a non-english plain code', () => {
    expect(getLanguageFallbacks('de')).toEqual(['de', 'en']);
  });

  it('always includes en as final fallback for non-en languages', () => {
    const fallbacks = getLanguageFallbacks('ja');
    expect(fallbacks[fallbacks.length - 1]).toBe('en');
  });
});
