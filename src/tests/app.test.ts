import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../app';

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/health').expect(200);

    expect(res.body).toEqual({ status: 'ok' });
  });
});
