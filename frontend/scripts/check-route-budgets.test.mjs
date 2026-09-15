import { describe, expect, it } from 'vitest';

import { assertNotesBudget, parseNotesFirstLoadKb } from './check-route-budgets.mjs';

const baseline = {
  notesFirstLoadKb: 421,
  maxNotesFirstLoadKb: 300,
  minReductionPercent: 25,
};

describe('route budget parser', () => {
  it('reads the /notes First Load JS value from a Next route table', () => {
    expect(parseNotesFirstLoadKb('Route (app)                                 Size  First Load JS\n├ ○ /notes                                  25 kB         298 kB')).toBe(298);
    expect(parseNotesFirstLoadKb('Route (app)                                 Size  First Load JS\n├ ○ /notes                                  25 kB         1.2 MB')).toBe(1200);
  });

  it('fails closed when the /notes route row is not emitted', () => {
    expect(() => parseNotesFirstLoadKb('Route (app)\n├ ○ /profile  5 kB  100 kB')).toThrow('/notes');
  });

  it('rejects absolute and relative budget regressions', () => {
    expect(() => assertNotesBudget(301, baseline)).toThrow('300 kB');
    expect(() => assertNotesBudget(400, baseline)).toThrow('25%');
    expect(assertNotesBudget(300, baseline)).toMatchObject({ reductionPercent: expect.any(Number) });
  });
});
