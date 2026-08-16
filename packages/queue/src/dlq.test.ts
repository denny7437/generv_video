import { describe, expect, it } from 'vitest';
import { isDlqCandidate } from './dlq.js';

describe('условие попадания в DLQ', () => {
  it('job с исчерпанными ретраями уходит в DLQ', () => {
    // attempts=4 (1 + 3 ретрая), attemptsMade=3 — последняя попытка.
    expect(isDlqCandidate({ attemptsMade: 3, attempts: 4 })).toBe(true);
  });

  it('job с оставшимися техническими ретраями не уходит в DLQ', () => {
    expect(isDlqCandidate({ attemptsMade: 0, attempts: 4 })).toBe(false);
    expect(isDlqCandidate({ attemptsMade: 2, attempts: 4 })).toBe(false);
  });

  it('без технических ретраев первая же неудача — в DLQ', () => {
    expect(isDlqCandidate({ attemptsMade: 0, attempts: 1 })).toBe(true);
  });
});
