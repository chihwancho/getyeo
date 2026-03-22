// src/__tests__/days.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../app';

describe('Day Endpoints', () => {
  let token: string;
  let vacationId: string;
  let dayId: string;
  let testEmail: string;

  beforeAll(async () => {
    // Register a test user
    testEmail = `test-${randomUUID()}@example.com`;
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'password123',
      });

    expect(registerRes.status).toBe(201);
    token = registerRes.body.token;

    // Create a test vacation (2026-04-01 to 2026-04-10 = 10 days auto-generated)
    const vacationRes = await request(app)
      .post('/api/vacations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Vacation',
        startDate: '2026-04-01',
        endDate: '2026-04-10',
      });

    expect(vacationRes.status).toBe(201);
    vacationId = vacationRes.body.id;
    // Days should be auto-generated, extract first day
    expect(vacationRes.body.days.length).toBe(10);
    dayId = vacationRes.body.days[0].id;
  });

  // ============================================================================
  // AUTO-GENERATION OF DAYS
  // ============================================================================

  describe('Auto-generation of Days on Vacation Create', () => {
    it('should auto-generate days for entire vacation date range', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.days).toHaveLength(10);
      expect(res.body.days[0].date).toBe('2026-04-01');
      expect(res.body.days[9].date).toBe('2026-04-10');
    });

    it('should not duplicate days when updating vacation with same dates', async () => {
      // Update vacation name (same dates)
      const updateRes = await request(app)
        .put(`/api/vacations/${vacationId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Updated Name',
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.days).toHaveLength(10); // Should still be 10
    });

    it('should regenerate days when vacation dates are extended', async () => {
      // Create a new vacation to extend
      const newVacRes = await request(app)
        .post('/api/vacations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'To Extend',
          startDate: '2026-05-01',
          endDate: '2026-05-03',
        });

      const newVacId = newVacRes.body.id;
      expect(newVacRes.body.days).toHaveLength(3);

      // Extend to 2026-05-10
      const extendRes = await request(app)
        .put(`/api/vacations/${newVacId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          endDate: '2026-05-10',
        });

      expect(extendRes.status).toBe(200);
      expect(extendRes.body.days).toHaveLength(10); // 2026-05-01 to 2026-05-10
    });
  });

  // ============================================================================
  // GET ALL DAYS
  // ============================================================================

  describe('GET /api/vacations/:vacationId/days', () => {
    it('should get all days for a vacation', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/days`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(10);
      expect(res.body[0].date).toBe('2026-04-01');
    });

    it('should sort days by date in ascending order', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/days`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      for (let i = 1; i < res.body.length; i++) {
        expect(res.body[i].date > res.body[i - 1].date).toBe(true);
      }
    });

    it('should fail without authentication', async () => {
      const res = await request(app).get(`/api/vacations/${vacationId}/days`);

      expect(res.status).toBe(401);
    });

    it('should deny access to other user\'s vacation days', async () => {
      const otherUserRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: `other-${randomUUID()}@example.com`,
          password: 'password123',
        });

      const otherToken = otherUserRes.body.token;

      const res = await request(app)
        .get(`/api/vacations/${vacationId}/days`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ============================================================================
  // GET SINGLE DAY
  // ============================================================================

  describe('GET /api/vacations/:vacationId/days/:dayId', () => {
    it('should get a single day by id', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/days/${dayId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(dayId);
      expect(res.body.date).toBe('2026-04-01');
      expect(res.body.vacationId).toBe(vacationId);
    });

    it('should fail without authentication', async () => {
      const res = await request(app).get(
        `/api/vacations/${vacationId}/days/${dayId}`
      );

      expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent day', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/days/invalid-id`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('should deny access to other user\'s vacation day', async () => {
      const otherUserRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: `other2-${randomUUID()}@example.com`,
          password: 'password123',
        });

      const otherToken = otherUserRes.body.token;

      const res = await request(app)
        .get(`/api/vacations/${vacationId}/days/${dayId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ============================================================================
  // CREATE DAY (Manual - rarely used)
  // ============================================================================

  describe('POST /api/vacations/:vacationId/days', () => {
    it('should manually create a day with valid data', async () => {
      const listRes = await request(app)
        .get(`/api/vacations/${vacationId}/days`)
        .set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);
      const apr6 = listRes.body.find((d: { date: string }) => d.date === '2026-04-06');
      expect(apr6).toBeDefined();
      await request(app)
        .delete(`/api/vacations/${vacationId}/days/${apr6.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await request(app)
        .post(`/api/vacations/${vacationId}/days`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          date: '2026-04-06',
          notes: 'Extra day',
        });

      expect(res.status).toBe(201);
      expect(res.body.date).toBe('2026-04-06');
      expect(res.body.notes).toBe('Extra day');
    });

    it('should fail without required date field', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/days`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          notes: 'No date',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('required');
    });

    it('should fail if date is outside vacation range', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/days`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          date: '2026-03-01', // Before vacation starts
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('vacation date range');
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/days`)
        .send({
          date: '2026-04-02',
        });

      expect(res.status).toBe(401);
    });
  });

  // ============================================================================
  // UPDATE DAY
  // ============================================================================

  describe('PUT /api/vacations/:vacationId/days/:dayId', () => {
    it('should update day notes', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}/days/${dayId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          notes: 'Updated notes',
        });

      expect(res.status).toBe(200);
      expect(res.body.notes).toBe('Updated notes');
    });

    it('should update day date within vacation range', async () => {
      const listRes = await request(app)
        .get(`/api/vacations/${vacationId}/days`)
        .set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);
      const apr1 = listRes.body.find((d: { date: string }) => d.date === '2026-04-01');
      const apr2 = listRes.body.find((d: { date: string }) => d.date === '2026-04-02');
      expect(apr1).toBeDefined();
      expect(apr2).toBeDefined();
      await request(app)
        .delete(`/api/vacations/${vacationId}/days/${apr2.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await request(app)
        .put(`/api/vacations/${vacationId}/days/${apr1.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          date: '2026-04-02',
        });

      expect(res.status).toBe(200);
      expect(res.body.date).toBe('2026-04-02');
    });

    it('should fail if updating to date outside vacation range', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}/days/${dayId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          date: '2026-06-01', // Outside vacation range
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('vacation date range');
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}/days/${dayId}`)
        .send({
          notes: 'Hacked',
        });

      expect(res.status).toBe(401);
    });

    it('should deny access to other user\'s vacation day', async () => {
      const otherUserRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: `other3-${randomUUID()}@example.com`,
          password: 'password123',
        });

      const otherToken = otherUserRes.body.token;

      const res = await request(app)
        .put(`/api/vacations/${vacationId}/days/${dayId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({
          notes: 'Hacked',
        });

      expect(res.status).toBe(403);
    });
  });

  // ============================================================================
  // DELETE DAY (Moves activities to unassigned pool)
  // ============================================================================

  describe('DELETE /api/vacations/:vacationId/days/:dayId', () => {
    it('should delete a day', async () => {
      const listRes = await request(app)
        .get(`/api/vacations/${vacationId}/days`)
        .set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);
      const apr7 = listRes.body.find((d: { date: string }) => d.date === '2026-04-07');
      expect(apr7).toBeDefined();
      await request(app)
        .delete(`/api/vacations/${vacationId}/days/${apr7.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const createRes = await request(app)
        .post(`/api/vacations/${vacationId}/days`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          date: '2026-04-07',
          notes: 'To delete',
        });

      expect(createRes.status).toBe(201);
      const dayToDeleteId = createRes.body.id;

      // Delete it
      const deleteRes = await request(app)
        .delete(`/api/vacations/${vacationId}/days/${dayToDeleteId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      // Verify it's gone
      const getRes = await request(app)
        .get(`/api/vacations/${vacationId}/days/${dayToDeleteId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.status).toBe(404);
    });

    it('should return 404 for non-existent day', async () => {
      const res = await request(app)
        .delete(`/api/vacations/${vacationId}/days/invalid-id`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('should fail without authentication', async () => {
      const res = await request(app).delete(
        `/api/vacations/${vacationId}/days/${dayId}`
      );

      expect(res.status).toBe(401);
    });

    it('should deny access to other user\'s vacation day', async () => {
      const otherUserRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: `other4-${randomUUID()}@example.com`,
          password: 'password123',
        });

      const otherToken = otherUserRes.body.token;

      const res = await request(app)
        .delete(`/api/vacations/${vacationId}/days/${dayId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ============================================================================
  // VACATION NOT FOUND
  // ============================================================================

  describe('Day endpoints with non-existent vacation', () => {
    it('should return 404 when getting days for non-existent vacation', async () => {
      const res = await request(app)
        .get('/api/vacations/invalid-vacation-id/days')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('should return 404 when creating day for non-existent vacation', async () => {
      const res = await request(app)
        .post('/api/vacations/invalid-vacation-id/days')
        .set('Authorization', `Bearer ${token}`)
        .send({
          date: '2026-04-01',
        });

      expect(res.status).toBe(404);
    });
  });
});