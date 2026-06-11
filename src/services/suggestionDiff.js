'use strict';

const { structuredPatch } = require('diff');

/**
 * Builds suggestion entries with unified diffs from OCR output.
 *
 * Suggestions come either from parsed OCR JSON findings
 * (existing_code / suggestion_code fields) or, when JSON parsing failed,
 * from "EXISTING CODE: / SUGGESTION CODE:" text blocks in raw stdout.
 *
 * This is best-effort: any failure returns null and the UI falls back
 * to the raw OCR output.
 */

function extractFindings(parsed) {
  if (!parsed) return null;
  const list = Array.isArray(parsed)
    ? parsed
    : parsed.comments || parsed.issues || parsed.results;
  return Array.isArray(list) && list.length > 0 ? list : null;
}

function findingFile(f) {
  return f.path || f.file || f.filename || null;
}

function findingLocation(f) {
  const file = findingFile(f);
  if (!file) return null;
  const start = f.start_line ?? f.line ?? f.lineNumber;
  const end = f.end_line;
  let loc = file;
  if (start != null) {
    loc += `:${start}`;
    if (end != null && end !== start) loc += `-${end}`;
  }
  return loc;
}

function findingText(f) {
  return f.content || f.comment || f.message || f.body || f.description || '';
}

/** Unified diff between two code snippets; null when they are identical. */
function buildUnifiedDiff(existingCode, suggestionCode, fileName) {
  const name = fileName || 'code';
  const ensureNl = (s) => (s.endsWith('\n') ? s : `${s}\n`);
  const patch = structuredPatch(
    name,
    name,
    ensureNl(String(existingCode)),
    ensureNl(String(suggestionCode)),
    '',
    '',
    { context: 3 }
  );
  if (!patch.hunks.length) return null;

  const lines = [`--- a/${name}`, `+++ b/${name}`];
  for (const hunk of patch.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    lines.push(...hunk.lines);
  }
  return lines.join('\n');
}

/** Parses "EXISTING CODE: ... SUGGESTION CODE: ..." blocks from raw text. */
function parseTextBlocks(raw) {
  const blocks = [];
  const re = /EXISTING CODE:\s*\n([\s\S]*?)\nSUGGESTION CODE:\s*\n([\s\S]*?)(?=\n\s*EXISTING CODE:|$)/g;
  let match;
  while ((match = re.exec(raw)) !== null) {
    const existingCode = match[1].trim();
    const suggestionCode = match[2].trim();
    if (existingCode && suggestionCode) blocks.push({ existingCode, suggestionCode });
  }
  return blocks;
}

/**
 * Returns an array of suggestion entries or null when nothing was parsed:
 * { findingIndex, location, text, existingCode, suggestionCode, diff }
 * findingIndex is the index in the parsed findings list (null for
 * suggestions recovered from raw text).
 */
function buildSuggestions({ parsed, rawStdout }) {
  try {
    const suggestions = [];

    const findings = extractFindings(parsed);
    if (findings) {
      findings.forEach((f, index) => {
        if (!f.existing_code || !f.suggestion_code) return;
        const diff = buildUnifiedDiff(f.existing_code, f.suggestion_code, findingFile(f));
        if (!diff) return;
        suggestions.push({
          findingIndex: index,
          location: findingLocation(f),
          text: findingText(f) || null,
          existingCode: f.existing_code,
          suggestionCode: f.suggestion_code,
          diff
        });
      });
    } else if (rawStdout) {
      for (const block of parseTextBlocks(rawStdout)) {
        const diff = buildUnifiedDiff(block.existingCode, block.suggestionCode, null);
        if (!diff) continue;
        suggestions.push({
          findingIndex: null,
          location: null,
          text: null,
          existingCode: block.existingCode,
          suggestionCode: block.suggestionCode,
          diff
        });
      }
    }

    return suggestions.length > 0 ? suggestions : null;
  } catch (err) {
    console.error(`Suggestion diff generation failed: ${err.message}`);
    return null;
  }
}

module.exports = { buildSuggestions };
