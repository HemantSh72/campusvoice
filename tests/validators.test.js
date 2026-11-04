/**
 * tests/validators.test.js
 * Unit tests for server/validate.js — sanitizers, enum validators, SLA/priority/department mapping.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeTranscript,
  clampStrings,
  validateEnums,
  sanitizeDraft,
  getDepartment,
  getSlaHours,
  PRIORITY_TO_SLA,
  CATEGORY_TO_DEPARTMENT,
} from '../server/validate.js';

// ─── sanitizeTranscript ───────────────────────────────────────────────────────

describe('sanitizeTranscript', () => {
  test('returns null for empty string', () => {
    assert.equal(sanitizeTranscript(''), null);
  });

  test('returns null for whitespace-only string', () => {
    assert.equal(sanitizeTranscript('   '), null);
  });

  test('returns null for non-string input', () => {
    assert.equal(sanitizeTranscript(null), null);
    assert.equal(sanitizeTranscript(undefined), null);
    assert.equal(sanitizeTranscript(42), null);
  });

  test('strips control characters', () => {
    const result = sanitizeTranscript('hello\x00\x01world');
    assert.equal(result, 'helloworld');
  });

  test('preserves newlines and tabs', () => {
    const result = sanitizeTranscript('line1\nline2\ttab');
    assert.equal(result, 'line1\nline2\ttab');
  });

  test('truncates to 500 characters', () => {
    const long = 'a'.repeat(600);
    const result = sanitizeTranscript(long);
    assert.equal(result.length, 500);
  });

  test('returns normal text unchanged', () => {
    const result = sanitizeTranscript('wifi is down in block A');
    assert.equal(result, 'wifi is down in block A');
  });
});

// ─── clampStrings ─────────────────────────────────────────────────────────────

describe('clampStrings', () => {
  test('clamps summary to 200 chars', () => {
    const result = clampStrings({ summary: 'a'.repeat(300) });
    assert.equal(result.summary.length, 200);
  });

  test('clamps location to 100 chars', () => {
    const result = clampStrings({ location: 'b'.repeat(150) });
    assert.equal(result.location.length, 100);
  });

  test('clamps reporterName to 60 chars', () => {
    const result = clampStrings({ reporterName: 'c'.repeat(80) });
    assert.equal(result.reporterName.length, 60);
  });

  test('leaves short strings unchanged', () => {
    const obj = { summary: 'short', location: 'room 1', reporterName: 'Alice' };
    const result = clampStrings(obj);
    assert.deepEqual(result, obj);
  });
});

// ─── validateEnums ────────────────────────────────────────────────────────────

describe('validateEnums', () => {
  test('replaces invalid intent with "unknown"', () => {
    const result = validateEnums({ intent: 'hack_system' });
    assert.equal(result.intent, 'unknown');
  });

  test('keeps valid intent unchanged', () => {
    const result = validateEnums({ intent: 'report_issue' });
    assert.equal(result.intent, 'report_issue');
  });

  test('replaces invalid category in draft with "other"', () => {
    const result = validateEnums({ intent: 'report_issue', draft: { category: 'aliens' } });
    assert.equal(result.draft.category, 'other');
  });

  test('replaces invalid priority in draft with "medium"', () => {
    const result = validateEnums({ intent: 'report_issue', draft: { priority: 'extreme' } });
    assert.equal(result.draft.priority, 'medium');
  });

  test('keeps valid category', () => {
    const result = validateEnums({ intent: 'report_issue', draft: { category: 'it' } });
    assert.equal(result.draft.category, 'it');
  });

  test('keeps valid priority', () => {
    const result = validateEnums({ intent: 'report_issue', draft: { priority: 'critical' } });
    assert.equal(result.draft.priority, 'critical');
  });
});

// ─── sanitizeDraft ────────────────────────────────────────────────────────────

describe('sanitizeDraft', () => {
  test('returns empty object for null input', () => {
    assert.deepEqual(sanitizeDraft(null), {});
  });

  test('returns empty object for non-object input', () => {
    assert.deepEqual(sanitizeDraft('string'), {});
  });

  test('extracts valid fields', () => {
    const draft = { summary: 'test issue', location: 'block A', category: 'it', priority: 'high' };
    const result = sanitizeDraft(draft);
    assert.equal(result.summary, 'test issue');
    assert.equal(result.location, 'block A');
    assert.equal(result.category, 'it');
    assert.equal(result.priority, 'high');
  });

  test('ignores unknown fields', () => {
    const result = sanitizeDraft({ summary: 'test', evil: 'payload', __proto__: {} });
    assert.equal(result.evil, undefined);
  });

  test('ignores invalid category', () => {
    const result = sanitizeDraft({ category: 'hack' });
    assert.equal(result.category, undefined);
  });
});

// ─── getDepartment ────────────────────────────────────────────────────────────

describe('getDepartment', () => {
  const cases = [
    ['it', 'IT & Network'],
    ['hostel', 'Hostel Warden'],
    ['mess', 'Mess & Canteen'],
    ['academics', 'Academic Office'],
    ['transport', 'Transport'],
    ['maintenance', 'Electrical & Maintenance'],
    ['library', 'Library'],
    ['safety', 'Security & Safety'],
    ['other', 'Administration'],
  ];

  for (const [cat, dept] of cases) {
    test(`maps ${cat} to ${dept}`, () => {
      assert.equal(getDepartment(cat), dept);
    });
  }

  test('maps unknown category to Administration', () => {
    assert.equal(getDepartment('unknown_category'), 'Administration');
  });
});

// ─── getSlaHours ──────────────────────────────────────────────────────────────

describe('getSlaHours', () => {
  test('critical = 2 hours', () => assert.equal(getSlaHours('critical'), 2));
  test('high = 8 hours', () => assert.equal(getSlaHours('high'), 8));
  test('medium = 24 hours', () => assert.equal(getSlaHours('medium'), 24));
  test('low = 72 hours', () => assert.equal(getSlaHours('low'), 72));
  test('unknown defaults to medium (24)', () => assert.equal(getSlaHours('unknown'), 24));
});
