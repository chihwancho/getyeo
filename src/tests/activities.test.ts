// src/tests/activities.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../app';

describe('Activity Endpoints', () => {
  let token: string;
  let vacationId: string;
  let dayId: string;
  let day2Id: string;
  let activityId: string;

  const baseActivity = {
    type: 'RESTAURANT',
    name: 'Pujol',
    location: 'Tennyson 133, Polanco, Mexico City',
    priority: 'MUST_HAVE',
    timeConstraint: 'EVENING',
  };

  beforeAll(async () => {
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({ email: `activities-${randomUUID()}@example.com`, password: 'password123' });

    expect(registerRes.status).toBe(201);
    token = registerRes.body.token;

    // Create vacation — auto-generates days Apr 1–5
    const vacationRes = await request(app)
      .post('/api/vacations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Mexico City 2026', startDate: '2026-04-01', endDate: '2026-04-05' });

    expect(vacationRes.status).toBe(201);
    vacationId = vacationRes.body.id;
    dayId = vacationRes.body.days[0].id;   // 2026-04-01
    day2Id = vacationRes.body.days[1].id;  // 2026-04-02
  });

  // ============================================================================
  // CREATE ACTIVITY
  // ============================================================================

  describe('POST /api/vacations/:vacationId/activities', () => {
    it('should create an activity in the unassigned pool (no dayId)', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send(baseActivity);

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      activityId = res.body.id;
      expect(res.body.name).toBe('Pujol');
      expect(res.body.type).toBe('RESTAURANT');
      expect(res.body.dayId).toBeNull();
      expect(res.body.vacationId).toBe(vacationId);
      expect(res.body.source).toBe('USER_ENTERED');
      expect(res.body.deletedAt).toBeNull();
    });

    it('should create an activity assigned to a specific day', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseActivity, name: 'Assigned Activity', dayId });

      expect(res.status).toBe(201);
      expect(res.body.dayId).toBe(dayId);
    });

    it('should create an activity with optional time and duration', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...baseActivity,
          name: 'Timed Activity',
          dayId,
          time: '19:30',
          duration: 90,
          timeConstraint: 'SPECIFIC_TIME',
        });

      expect(res.status).toBe(201);
      expect(res.body.time).toBe('19:30');
      expect(res.body.duration).toBe(90);
    });

    it('should create an activity with all optional fields', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...baseActivity,
          name: 'Full Activity',
          dayId,
          time: '10:00',
          duration: 120,
          position: 1,
          notes: 'Book in advance',
          timeConstraint: 'MORNING',
          priority: 'NICE_TO_HAVE',
        });

      expect(res.status).toBe(201);
      expect(res.body.notes).toBe('Book in advance');
      expect(res.body.position).toBe(1);
      expect(res.body.priority).toBe('NICE_TO_HAVE');
    });

    it('should fail with missing required fields', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Missing Fields' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('required');
    });

    it('should fail with invalid time format', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseActivity, time: '7pm' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('HH:mm');
    });

    it('should fail with a dayId from a different vacation', async () => {
      const otherVacRes = await request(app)
        .post('/api/vacations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Other Vacation', startDate: '2026-05-01', endDate: '2026-05-03' });

      const otherDayId = otherVacRes.body.days[0].id;

      const res = await request(app)
        .post(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseActivity, dayId: otherDayId });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Day not found in this vacation');
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/activities`)
        .send(baseActivity);

      expect(res.status).toBe(401);
    });

    it('should fail for non-existent vacation', async () => {
      const res = await request(app)
        .post('/api/vacations/invalid-vacation-id/activities')
        .set('Authorization', `Bearer ${token}`)
        .send(baseActivity);

      expect(res.status).toBe(404);
    });

    it('should deny access to another user\'s vacation', async () => {
      const otherRes = await request(app)
        .post('/api/auth/register')
        .send({ email: `other-${randomUUID()}@example.com`, password: 'password123' });

      const res = await request(app)
        .post(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${otherRes.body.token}`)
        .send(baseActivity);

      expect(res.status).toBe(403);
    });
  });

  // ============================================================================
  // GET ACTIVITIES
  // ============================================================================

  describe('GET /api/vacations/:vacationId/activities', () => {
    it('should get all activities for a vacation', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('should filter activities by dayId', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/activities?dayId=${dayId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      res.body.forEach((a: any) => expect(a.dayId).toBe(dayId));
    });

    it('should get unassigned pool with dayId=null', async () => {
      // Ensure there is at least one unassigned activity
      await request(app)
        .post(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseActivity, name: 'Unassigned Activity' });

      const res = await request(app)
        .get(`/api/vacations/${vacationId}/activities?dayId=null`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      res.body.forEach((a: any) => expect(a.dayId).toBeNull());
    });

    it('should exclude hard-deleted activities', async () => {
      // Create and hard-delete an activity
      const createRes = await request(app)
        .post(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseActivity, name: 'To Hard Delete' });

      await request(app)
        .delete(`/api/vacations/${vacationId}/activities/${createRes.body.id}`)
        .set('Authorization', `Bearer ${token}`);

      const res = await request(app)
        .get(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const deleted = res.body.find((a: any) => a.id === createRes.body.id);
      expect(deleted).toBeUndefined();
    });

    it('should sort activities by time then position then createdAt', async () => {
      // Create a fresh vacation so we control all activities
      const sortVacRes = await request(app)
        .post('/api/vacations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Sort Test', startDate: '2026-06-01', endDate: '2026-06-03' });

      const sortVacId = sortVacRes.body.id;
      const sortDayId = sortVacRes.body.days[0].id;

      await request(app)
        .post(`/api/vacations/${sortVacId}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseActivity, name: 'Late', dayId: sortDayId, time: '20:00', timeConstraint: 'SPECIFIC_TIME' });

      await request(app)
        .post(`/api/vacations/${sortVacId}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseActivity, name: 'Early', dayId: sortDayId, time: '08:00', timeConstraint: 'SPECIFIC_TIME' });

      const res = await request(app)
        .get(`/api/vacations/${sortVacId}/activities?dayId=${sortDayId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body[0].name).toBe('Early');
      expect(res.body[1].name).toBe('Late');
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/activities`);

      expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent vacation', async () => {
      const res = await request(app)
        .get('/api/vacations/invalid-vacation-id/activities')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('should deny access to another user\'s vacation', async () => {
      const otherRes = await request(app)
        .post('/api/auth/register')
        .send({ email: `other-${randomUUID()}@example.com`, password: 'password123' });

      const res = await request(app)
        .get(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${otherRes.body.token}`);

      expect(res.status).toBe(403);
    });
  });

  // ============================================================================
  // GET SINGLE ACTIVITY
  // ============================================================================

  describe('GET /api/vacations/:vacationId/activities/:activityId', () => {
    it('should get a single activity by id', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/activities/${activityId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(activityId);
      expect(res.body.name).toBe('Pujol');
      expect(res.body.vacationId).toBe(vacationId);
    });

    it('should return 404 for non-existent activity', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/activities/invalid-id`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('should return 404 for activity from a different vacation', async () => {
      const otherVacRes = await request(app)
        .post('/api/vacations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Other Vac', startDate: '2026-07-01', endDate: '2026-07-03' });

      const otherActivityRes = await request(app)
        .post(`/api/vacations/${otherVacRes.body.id}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send(baseActivity);

      // Try fetching the other vacation's activity under our vacationId
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/activities/${otherActivityRes.body.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('should return 404 for a hard-deleted activity', async () => {
      const createRes = await request(app)
        .post(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseActivity, name: 'Will Be Deleted' });

      await request(app)
        .delete(`/api/vacations/${vacationId}/activities/${createRes.body.id}`)
        .set('Authorization', `Bearer ${token}`);

      const res = await request(app)
        .get(`/api/vacations/${vacationId}/activities/${createRes.body.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .get(`/api/vacations/${vacationId}/activities/${activityId}`);

      expect(res.status).toBe(401);
    });

    it('should deny access to another user\'s vacation', async () => {
      const otherRes = await request(app)
        .post('/api/auth/register')
        .send({ email: `other-${randomUUID()}@example.com`, password: 'password123' });

      const res = await request(app)
        .get(`/api/vacations/${vacationId}/activities/${activityId}`)
        .set('Authorization', `Bearer ${otherRes.body.token}`);

      expect(res.status).toBe(403);
    });
  });

  // ============================================================================
  // UPDATE ACTIVITY
  // ============================================================================

  describe('PUT /api/vacations/:vacationId/activities/:activityId', () => {
    it('should update activity name', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}/activities/${activityId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Quintonil' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Quintonil');
      expect(res.body.id).toBe(activityId);
    });

    it('should update multiple fields at once', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}/activities/${activityId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Updated Restaurant',
          priority: 'NICE_TO_HAVE',
          notes: 'Updated notes',
          time: '20:00',
          duration: 60,
        });

      expect(res.status).toBe(200);
      expect(res.body.priority).toBe('NICE_TO_HAVE');
      expect(res.body.notes).toBe('Updated notes');
      expect(res.body.time).toBe('20:00');
      expect(res.body.duration).toBe(60);
    });

    it('should assign activity to a day via update', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}/activities/${activityId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ dayId });

      expect(res.status).toBe(200);
      expect(res.body.dayId).toBe(dayId);
    });

    it('should move activity to unassigned pool by setting dayId to null', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}/activities/${activityId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ dayId: null });

      expect(res.status).toBe(200);
      expect(res.body.dayId).toBeNull();
    });

    it('should fail with invalid time format', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}/activities/${activityId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ time: '8pm' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('HH:mm');
    });

    it('should fail with a dayId from a different vacation', async () => {
      const otherVacRes = await request(app)
        .post('/api/vacations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Other Vac', startDate: '2026-08-01', endDate: '2026-08-03' });

      const otherDayId = otherVacRes.body.days[0].id;

      const res = await request(app)
        .put(`/api/vacations/${vacationId}/activities/${activityId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ dayId: otherDayId });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Day not found in this vacation');
    });

    it('should return 404 for non-existent activity', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}/activities/invalid-id`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Ghost' });

      expect(res.status).toBe(404);
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .put(`/api/vacations/${vacationId}/activities/${activityId}`)
        .send({ name: 'Hacked' });

      expect(res.status).toBe(401);
    });

    it('should deny access to another user\'s vacation', async () => {
      const otherRes = await request(app)
        .post('/api/auth/register')
        .send({ email: `other-${randomUUID()}@example.com`, password: 'password123' });

      const res = await request(app)
        .put(`/api/vacations/${vacationId}/activities/${activityId}`)
        .set('Authorization', `Bearer ${otherRes.body.token}`)
        .send({ name: 'Hacked' });

      expect(res.status).toBe(403);
    });
  });

  // ============================================================================
  // MOVE ACTIVITY
  // ============================================================================

  describe('POST /api/vacations/:vacationId/activities/:activityId/move', () => {
    it('should move an activity to a different day', async () => {
      // First assign activity to day1
      await request(app)
        .put(`/api/vacations/${vacationId}/activities/${activityId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ dayId });

      const res = await request(app)
        .post(`/api/vacations/${vacationId}/activities/${activityId}/move`)
        .set('Authorization', `Bearer ${token}`)
        .send({ dayId: day2Id });

      expect(res.status).toBe(200);
      expect(res.body.dayId).toBe(day2Id);
    });

    it('should move an activity to the unassigned pool', async () => {
      // Use a dedicated activity so this test isn't order-dependent
      const createRes = await request(app)
        .post(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseActivity, name: 'Move To Pool', dayId });

      expect(createRes.status).toBe(201);
      expect(createRes.body.dayId).toBe(dayId);

      const res = await request(app)
        .post(`/api/vacations/${vacationId}/activities/${createRes.body.id}/move`)
        .set('Authorization', `Bearer ${token}`)
        .send({ dayId: null });

      expect(res.status).toBe(200);
      expect(res.body.dayId).toBeNull();
    });

    it('should fail with a dayId from a different vacation', async () => {
      const otherVacRes = await request(app)
        .post('/api/vacations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Other Vac', startDate: '2026-09-01', endDate: '2026-09-03' });

      const otherDayId = otherVacRes.body.days[0].id;

      const res = await request(app)
        .post(`/api/vacations/${vacationId}/activities/${activityId}/move`)
        .set('Authorization', `Bearer ${token}`)
        .send({ dayId: otherDayId });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Day not found in this vacation');
    });

    it('should return 404 for non-existent activity', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/activities/invalid-id/move`)
        .set('Authorization', `Bearer ${token}`)
        .send({ dayId });

      expect(res.status).toBe(404);
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .post(`/api/vacations/${vacationId}/activities/${activityId}/move`)
        .send({ dayId });

      expect(res.status).toBe(401);
    });

    it('should deny access to another user\'s vacation', async () => {
      const otherRes = await request(app)
        .post('/api/auth/register')
        .send({ email: `other-${randomUUID()}@example.com`, password: 'password123' });

      const res = await request(app)
        .post(`/api/vacations/${vacationId}/activities/${activityId}/move`)
        .set('Authorization', `Bearer ${otherRes.body.token}`)
        .send({ dayId });

      expect(res.status).toBe(403);
    });
  });

  // ============================================================================
  // DELETE ACTIVITY
  // ============================================================================

  describe('DELETE /api/vacations/:vacationId/activities/:activityId', () => {
    it('should hard-delete an activity (sets deletedAt, excludes from queries)', async () => {
      const createRes = await request(app)
        .post(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseActivity, name: 'Hard Delete Me' });

      const id = createRes.body.id;

      const deleteRes = await request(app)
        .delete(`/api/vacations/${vacationId}/activities/${id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      // Should be gone from GET single
      const getRes = await request(app)
        .get(`/api/vacations/${vacationId}/activities/${id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.status).toBe(404);
    });

    it('should soft-delete an activity (moves to unassigned pool, keeps in DB)', async () => {
      const createRes = await request(app)
        .post(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseActivity, name: 'Soft Delete Me', dayId });

      const id = createRes.body.id;
      expect(createRes.body.dayId).toBe(dayId);

      const deleteRes = await request(app)
        .delete(`/api/vacations/${vacationId}/activities/${id}?softDelete=true`)
        .set('Authorization', `Bearer ${token}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      // Should still be accessible — moved to unassigned pool
      const getRes = await request(app)
        .get(`/api/vacations/${vacationId}/activities/${id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.dayId).toBeNull();
    });

    it('should soft-delete an unassigned activity (keeps it in pool)', async () => {
      const createRes = await request(app)
        .post(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseActivity, name: 'Unassigned Soft Delete' }); // no dayId

      const id = createRes.body.id;

      const deleteRes = await request(app)
        .delete(`/api/vacations/${vacationId}/activities/${id}?softDelete=true`)
        .set('Authorization', `Bearer ${token}`);

      expect(deleteRes.status).toBe(200);

      // Still accessible and still unassigned
      const getRes = await request(app)
        .get(`/api/vacations/${vacationId}/activities/${id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.dayId).toBeNull();
    });

    it('should return 404 for non-existent activity', async () => {
      const res = await request(app)
        .delete(`/api/vacations/${vacationId}/activities/invalid-id`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('should fail without authentication', async () => {
      const res = await request(app)
        .delete(`/api/vacations/${vacationId}/activities/${activityId}`);

      expect(res.status).toBe(401);
    });

    it('should deny access to another user\'s vacation', async () => {
      const otherRes = await request(app)
        .post('/api/auth/register')
        .send({ email: `other-${randomUUID()}@example.com`, password: 'password123' });

      const res = await request(app)
        .delete(`/api/vacations/${vacationId}/activities/${activityId}`)
        .set('Authorization', `Bearer ${otherRes.body.token}`);

      expect(res.status).toBe(403);
    });
  });

  // ============================================================================
  // CROSS-CUTTING: DAY DELETION MOVES ACTIVITIES TO POOL
  // ============================================================================

  describe('Day deletion moves activities to unassigned pool', () => {
    it('should move activities to pool when their day is deleted', async () => {
      // Create a fresh vacation with a clean day
      const vRes = await request(app)
        .post('/api/vacations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Pool Test', startDate: '2026-10-01', endDate: '2026-10-03' });

      const vId = vRes.body.id;
      const dId = vRes.body.days[0].id;

      // Add two activities to that day
      const a1 = await request(app)
        .post(`/api/vacations/${vId}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseActivity, name: 'Activity 1', dayId: dId });

      const a2 = await request(app)
        .post(`/api/vacations/${vId}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseActivity, name: 'Activity 2', dayId: dId });

      // Delete the day
      await request(app)
        .delete(`/api/vacations/${vId}/days/${dId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Both activities should now be in the unassigned pool
      const poolRes = await request(app)
        .get(`/api/vacations/${vId}/activities?dayId=null`)
        .set('Authorization', `Bearer ${token}`);

      expect(poolRes.status).toBe(200);
      const ids = poolRes.body.map((a: any) => a.id);
      expect(ids).toContain(a1.body.id);
      expect(ids).toContain(a2.body.id);
    });
  });

  // ============================================================================
  // CROSS-CUTTING: ACTIVITY ISOLATION BETWEEN VACATIONS
  // ============================================================================

  describe('Activity isolation between vacations', () => {
    it('should not return activities from other vacations', async () => {
      const otherVacRes = await request(app)
        .post('/api/vacations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Isolated Vacation', startDate: '2026-11-01', endDate: '2026-11-03' });

      await request(app)
        .post(`/api/vacations/${otherVacRes.body.id}/activities`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseActivity, name: 'Other Vacation Activity' });

      const res = await request(app)
        .get(`/api/vacations/${vacationId}/activities`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const leaked = res.body.find((a: any) => a.name === 'Other Vacation Activity');
      expect(leaked).toBeUndefined();
    });
  });
});