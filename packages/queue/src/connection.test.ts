import { describe, expect, it } from 'vitest';
import { bullMqConnection } from './connection.js';

describe('подключение к Redis', () => {
  it('читает REDIS_HOST/REDIS_PORT и выставляет maxRetriesPerRequest: null', () => {
    expect(bullMqConnection({ REDIS_HOST: 'redis.local', REDIS_PORT: '6380' })).toEqual({
      host: 'redis.local',
      port: 6380,
      maxRetriesPerRequest: null,
    });
  });

  it('дефолты — localhost:6379', () => {
    expect(bullMqConnection({})).toEqual({
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
    });
  });
});
