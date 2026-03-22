// src/__tests__/homestays.test.ts
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';

describe('Homestay Endpoints', () => {
  let token: string;
  let vacationId: string;
  let homestayId: string;
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

    // Create a test vacation
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
  });

  // ============================================================================
  // CREATE HOMESTAY
  // ============================================================================

  describe('POST /api/vacations/:vacationId/homestays', () => {
    it('should create a homestay with valid data', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/homestays`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Casa Bonita',
          address: 'Paseo de la Reforma 505, Mexico City',
          checkInDate: '2026-04-01',
          checkOutDate: '2026-04-05',
          notes: 'Beautiful colonial style',
        });

      console.log('Response status:', res.status);
      console.log('Response body:', res.body);

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Casa Bonita');
      expect(res.body.checkInDate).toBe('2026-04-01');
      expect(res.body.checkOutDate).toBe('2026-04-05');
      expect(res.body.notes).toBe('Beautiful colonial style');
      homestayId = res.body.id;
    });

    it('should create a homestay without notes', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/homestays`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Simple Hotel',
          address: 'Calle Principal 123',
          checkInDate: '2026-04-05',
          checkOutDate: '2026-04-10',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Simple Hotel');
      expect(res.body.notes).toBeNull();
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/homestays`)
        .send({
          name: 'Test Homestay',
          address: 'Test Address',
          checkInDate: '2026-04-01',
          checkOutDate: '2026-04-05',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('should fail with missing required fields', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/homestays`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Test Homestay',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('required');
    });

    it('should fail when check-in is after check-out', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/homestays`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Invalid Dates',
          address: 'Test Address',
          checkInDate: '2026-04-10',
          checkOutDate: '2026-04-05',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Check-in date must be before check-out date');
    });

    it('should fail for non-existent vacation', async () => {
      const res = await request(app)
        .post('/api/vacations/invalid-id/homestays')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Test Homestay',
          address: 'Test Address',
          checkInDate: '2026-04-01',
          checkOutDate: '2026-04-05',
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('not found');
    });

    it('should deny access to other user\'s vacation', async () => {
      const otherUserRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: `other-${randomUUID()}@example.com`,
          password: 'password123',
        });

      const otherToken = otherUserRes.body.token;

      const res = await request(app)
        .post(`/api/vacations/${vacationId}/homestays`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({
          name: 'Hacked Homestay',
          address: 'Test Address',
          checkInDate: '2026-04-01',
          checkOutDate: '2026-04-05',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('do not have access');
    });
  });

  // ============================================================================
  // GET ALL HOMESTAYS
  // ============================================================================

  describe('GET /api/vacations/:vacationId/homestays', () => {
    it('should get all homestays for vacation', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/homestays`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].id).toBeDefined();
      expect(res.body[0].name).toBeDefined();
    });

    it('should return homestays ordered by check-in date', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/homestays`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const dates = res.body.map((h: any) => new Date(h.checkInDate).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
      }
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/homestays`);

      expect(res.status).toBe(401);
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
        .get(`/api/vacations/${vacationId}/homestays`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ============================================================================
  // GET SINGLE HOMESTAY
  // ============================================================================

  describe('GET /api/vacations/:vacationId/homestays/:homestayId', () => {
    it('should get a single homestay by id', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/homestays/${homestayId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(homestayId);
      expect(res.body.name).toBe('Casa Bonita');
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/homestays/${homestayId}`);

      expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent homestay', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/homestays/invalid-id`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('not found');
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
        .get(`/api/vacations/${vacationId}/homestays/${homestayId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ============================================================================
  // UPDATE HOMESTAY
  // ============================================================================

  describe('PUT /api/vacations/:vacationId/homestays/:homestayId', () => {
    it('should update homestay name', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}/homestays/${homestayId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Updated Casa Bonita',
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Casa Bonita');
      expect(res.body.id).toBe(homestayId);
    });

    it('should update homestay address', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}/homestays/${homestayId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          address: 'Nueva Dirección 999',
        });

      expect(res.status).toBe(200);
      expect(res.body.address).toBe('Nueva Dirección 999');
    });

    it('should update homestay dates', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}/homestays/${homestayId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          checkInDate: '2026-04-02',
          checkOutDate: '2026-04-06',
        });

      expect(res.status).toBe(200);
      expect(res.body.checkInDate).toBe('2026-04-02');
      expect(res.body.checkOutDate).toBe('2026-04-06');
    });

    it('should update homestay notes', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}/homestays/${homestayId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          notes: 'Updated notes',
        });

      expect(res.status).toBe(200);
      expect(res.body.notes).toBe('Updated notes');
    });

    it('should fail with invalid dates', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}/homestays/${homestayId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          checkInDate: '2026-04-10',
          checkOutDate: '2026-04-05',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Check-in date must be before check-out date');
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}/homestays/${homestayId}`)
        .send({
          name: 'Hacked',
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
        .put(`/api/vacations/${vacationId}/homestays/${homestayId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({
          name: 'Hacked',
        });

      expect(res.status).toBe(403);
    });
  });

  // ============================================================================
  // DELETE HOMESTAY
  // ============================================================================

  describe('DELETE /api/vacations/:vacationId/homestays/:homestayId', () => {
    it('should delete a homestay', async () => {
      // Create a homestay to delete
      const createRes = await request(app)
        .post(`/api/vacations/${vacationId}/homestays`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'To Delete',
          address: 'Delete Address',
          checkInDate: '2026-04-06',
          checkOutDate: '2026-04-08',
        });

      const homestayToDeleteId = createRes.body.id;

      // Delete it
      const deleteRes = await request(app)
        .delete(`/api/vacations/${vacationId}/homestays/${homestayToDeleteId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      // Verify it's gone
      const getRes = await request(app)
        .get(`/api/vacations/${vacationId}/homestays/${homestayToDeleteId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.status).toBe(404);
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .delete(`/api/vacations/${vacationId}/homestays/${homestayId}`);

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
        .delete(`/api/vacations/${vacationId}/homestays/${homestayId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
    });

    it('should return 404 for non-existent homestay', async () => {
      const res = await request(app)
        .delete(`/api/vacations/${vacationId}/homestays/invalid-id`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });
});