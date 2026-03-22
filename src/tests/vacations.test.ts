// src/__tests__/vacations.test.ts
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';

describe('Vacation Endpoints', () => {
  let token: string;
  let vacationId: string;
  let variantId: string;
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
    expect(registerRes.body.token).toBeDefined();
    token = registerRes.body.token;
  });

  // ============================================================================
  // CREATE VACATION
  // ============================================================================

  describe('POST /api/vacations', () => {
    it('should create a vacation with valid data', async () => {
      const res = await request(app)
        .post('/api/vacations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Mexico City 2026',
          startDate: '2026-04-01',
          endDate: '2026-04-10',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      vacationId = res.body.id;
      expect(res.body.name).toBe('Mexico City 2026');
      expect(res.body.version).toBe(1);
      // Apr 1–10 inclusive → 10 Day rows auto-generated
      expect(res.body.days).toHaveLength(10);
      expect(res.body.homestays).toEqual([]);
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .post('/api/vacations')
        .send({
          name: 'Test Vacation',
          startDate: '2026-04-01',
          endDate: '2026-04-10',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('should fail with missing required fields', async () => {
      const res = await request(app)
        .post('/api/vacations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Test Vacation',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('required');
    });

    it('should fail when start date is after end date', async () => {
      const res = await request(app)
        .post('/api/vacations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Invalid Vacation',
          startDate: '2026-04-10',
          endDate: '2026-04-01',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Start date must be before end date');
    });
  });

  // ============================================================================
  // GET ALL VACATIONS
  // ============================================================================

  describe('GET /api/vacations', () => {
    it('should get all vacations for user', async () => {
      const res = await request(app)
        .get('/api/vacations')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].id).toBeDefined();
      expect(res.body[0].name).toBeDefined();
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .get('/api/vacations');

      expect(res.status).toBe(401);
    });

    it('should only return user\'s own vacations', async () => {
      // Register another user
      const otherUserRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: `other-${randomUUID()}@example.com`,
          password: 'password123',
        });

      const otherToken = otherUserRes.body.token;

      // Other user gets their vacations (should be empty or different)
      const res = await request(app)
        .get('/api/vacations')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(200);
      // Other user shouldn't see our vacation
      const ourVacation = res.body.find((v: any) => v.id === vacationId);
      expect(ourVacation).toBeUndefined();
    });
  });

  // ============================================================================
  // GET SINGLE VACATION
  // ============================================================================

  describe('GET /api/vacations/:id', () => {
    it('should get a single vacation by id', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(vacationId);
      expect(res.body.name).toBe('Mexico City 2026');
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}`);

      expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent vacation', async () => {
      const res = await request(app)
        .get('/api/vacations/invalid-id')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('not found');
    });

    it('should deny access to other user\'s vacation', async () => {
      const otherUserRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: `other2-${randomUUID()}@example.com`,
          password: 'password123',
        });

      const otherToken = otherUserRes.body.token;

      const res = await request(app)
        .get(`/api/vacations/${vacationId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('do not have access');
    });
  });

  // ============================================================================
  // UPDATE VACATION
  // ============================================================================

  describe('PUT /api/vacations/:id', () => {
    it('should update vacation name', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Updated Mexico City Trip',
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Mexico City Trip');
      expect(res.body.id).toBe(vacationId);
    });

    it('should update dates', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          startDate: '2026-05-01',
          endDate: '2026-05-15',
        });

      expect(res.status).toBe(200);
      expect(res.body.startDate).toBe('2026-05-01');
      expect(res.body.endDate).toBe('2026-05-15');
    });

    it('should fail when updating with invalid dates', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          startDate: '2026-05-15',
          endDate: '2026-05-01',
        });

      expect(res.status).toBe(400);
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}`)
        .send({
          name: 'Hacked',
        });

      expect(res.status).toBe(401);
    });

    it('should deny access to other user\'s vacation', async () => {
      const otherUserRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: `other3-${randomUUID()}@example.com`,
          password: 'password123',
        });

      const otherToken = otherUserRes.body.token;

      const res = await request(app)
        .put(`/api/vacations/${vacationId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({
          name: 'Hacked',
        });

      expect(res.status).toBe(403);
    });
  });

  // ============================================================================
  // CREATE VACATION VARIANT
  // ============================================================================

  describe('POST /api/vacations/:id/variants', () => {
    it('should create a vacation variant', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/variants`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          variant: 'food-focused',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.variant).toBe('food-focused');
      expect(res.body.parentVacationId).toBe(vacationId);
      expect(res.body.name).toContain('food-focused');
      variantId = res.body.id;
    });

    it('should fail without variant name', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/variants`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/variants`)
        .send({
          variant: 'museum-focused',
        });

      expect(res.status).toBe(401);
    });

    it('should deny access to other user\'s vacation', async () => {
      const otherUserRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: `other4-${randomUUID()}@example.com`,
          password: 'password123',
        });

      const otherToken = otherUserRes.body.token;

      const res = await request(app)
        .post(`/api/vacations/${vacationId}/variants`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({
          variant: 'hacked',
        });

      expect(res.status).toBe(403);
    });
  });

  // ============================================================================
  // GET VACATION VERSIONS
  // ============================================================================

  describe('GET /api/vacations/:id/versions', () => {
    it('should get vacation versions', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/versions`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/versions`);

      expect(res.status).toBe(401);
    });

    it('should deny access to other user\'s vacation', async () => {
      const otherUserRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: `other5-${randomUUID()}@example.com`,
          password: 'password123',
        });

      const otherToken = otherUserRes.body.token;

      const res = await request(app)
        .get(`/api/vacations/${vacationId}/versions`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ============================================================================
  // DELETE VACATION
  // ============================================================================

  describe('DELETE /api/vacations/:id', () => {
    it('should delete a vacation', async () => {
      // Create a vacation to delete
      const createRes = await request(app)
        .post('/api/vacations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'To Delete',
          startDate: '2026-06-01',
          endDate: '2026-06-10',
        });

      const vacationToDeleteId = createRes.body.id;

      // Delete it
      const deleteRes = await request(app)
        .delete(`/api/vacations/${vacationToDeleteId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      // Verify it's gone
      const getRes = await request(app)
        .get(`/api/vacations/${vacationToDeleteId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.status).toBe(404);
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .delete(`/api/vacations/${vacationId}`);

      expect(res.status).toBe(401);
    });

    it('should deny access to other user\'s vacation', async () => {
      const otherUserRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: `other6-${randomUUID()}@example.com`,
          password: 'password123',
        });

      const otherToken = otherUserRes.body.token;

      const res = await request(app)
        .delete(`/api/vacations/${vacationId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
    });

    it('should return 404 for non-existent vacation', async () => {
      const res = await request(app)
        .delete('/api/vacations/invalid-id')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });
});