// Minimal CJS shim so Jest can import caption-parser.ts without
// needing Babel to transpile @plussub/srt-vtt-parser's ESM bundle.
// parseCaption() is tested via the unit tests for caption-parser.ts;
// formatDuration() and segmentCaptions() don't call parse() at all.
module.exports = {
  parse: jest.fn(() => ({ entries: [] })),
};
