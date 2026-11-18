import { describe, expect, it } from 'vitest';
import { compile, makeTranslate } from '../src/i18n/translator';
import { RO } from '../src/i18n/ro';

const tr = makeTranslate(compile(RO));

describe('Romanian translation', () => {
  it('translates exact strings and keeps surrounding spaces', () => {
    expect(tr('Settings')).toBe('Setări');
    expect(tr(' Pause ')).toBe(' Pauză ');
    expect(tr('C4')).toBe('C4');
    expect(tr('Something not in the table')).toBe('Something not in the table');
  });
  it('fills patterns and translates their parts', () => {
    expect(tr('Round 2 of 5')).toBe('Runda 2 din 5');
    expect(tr('Right note, one octave low')).toBe('Nota corectă, o octavă mai jos');
    expect(tr('Right note, 2 octaves high')).toBe('Nota corectă, 2 octave mai sus');
    expect(tr('Sing it and hold 1.5 s')).toBe('Cânt-o și ține-o 1.5 s');
  });
  it('handles plurals', () => {
    expect(tr('1 round left')).toBe('1 rundă rămasă');
    expect(tr('3 rounds left')).toBe('3 runde rămase');
    expect(tr('2 minutes today keeps your 1-day streak.')).toBe('2 minute azi îți păstrează seria de 1 zi.');
    expect(tr('Life happens. Repair your 12-day streak with 2 more sessions (30 h left).')).toBe('Se mai întâmplă. Repară-ți seria de 12 zile cu încă 2 sesiuni (mai ai 30 h).');
  });
  it('every pattern has the same placeholders on both sides', () => {
    for (const [en, ro] of RO) {
      if (typeof ro !== 'string') continue;
      const a = (en.match(/\{\d\}/g) ?? []).sort().join();
      const b = (ro.match(/\{\d\}/g) ?? []).sort().join();
      expect(b, en).toBe(a);
    }
  });
});

describe('loose patterns', () => {
  it('never half-translate a sentence', () => {
    expect(tr('Tone: each note is short and fades out. Root drone hums the tonic underneath.')).toBe('Tone: each note is short and fades out. Root drone hums the tonic underneath.');
    expect(tr('Degrees: 1 · 5 · key of B')).toBe('Degrees: 1 · 5 · key of B');
    expect(tr('★ New best: 5 in a row')).toBe('★ Record nou: 5 la rând');
    expect(tr('Chest → Falsetto')).toBe('Piept → Falset');
    expect(tr(' · key of B')).toBe(' · tonalitatea B');
  });
});
