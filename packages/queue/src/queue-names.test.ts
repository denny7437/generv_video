import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QUEUE_NAMES, dlqNameFor, queueDefinitions } from './queue-names.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/queue/src -> contracts/queues
const contractsDir = join(here, '..', '..', '..', 'contracts', 'queues');

describe('имена очередей', () => {
  it('совпадают с именами файлов contracts/queues/*.json', () => {
    const files = readdirSync(contractsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
    expect([...QUEUE_NAMES].sort()).toEqual(files);
  });

  it('определены ровно четыре очереди', () => {
    expect(queueDefinitions()).toHaveLength(4);
  });

  it('у каждой очереди настроена собственная DLQ', () => {
    for (const def of queueDefinitions()) {
      expect(def.dlqName).toBe(dlqNameFor(def.name));
      expect(def.dlqName).not.toBe(def.name);
    }
  });

  it('имя DLQ не содержит ":" — BullMQ не принимает двоеточие в имени очереди', () => {
    for (const def of queueDefinitions()) {
      expect(def.dlqName).not.toContain(':');
    }
  });
});
