import { describe, expect, it } from 'vitest';
import { parseBackup, describeBackup } from '../src/lib/backup';

describe('backup parsing', () => {
  it('accepts a valid backup', () => {
    const b = parseBackup(JSON.stringify({ app: 'pitch-trainer', format: 1, version: '0.6.0', exportedAt: '2026-11-18T00:00:00Z', kv: [{ key: 'practiceLog', value: { '2026-11-17': 300, '2026-11-16': 200 } }], attempts: [{ ts: 1 }] }));
    expect(describeBackup(b)).toMatch(/^1 attempts, 2 practice days/);
  });
  it('rejects junk with a friendly message', () => {
    expect(() => parseBackup('nope')).toThrow(/valid JSON/);
    expect(() => parseBackup('{"app":"other","kv":[],"attempts":[]}')).toThrow(/Pitch Trainer backup/);
    expect(() => parseBackup('{"app":"pitch-trainer","kv":[{"value":1}],"attempts":[]}')).toThrow(/damaged/);
  });
});
