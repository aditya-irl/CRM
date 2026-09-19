import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole, KYCType } from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('Customer Data, Manual Route & Dynamic KYC Integration Tests', () => {
  const runId = Date.now().toString(36);
  const adminEmail = `admin_${runId}@customertest.com`;
  let adminToken: string;

  beforeAll(async () => {
    const adminId = uuidv4();
    const hash = bcrypt.hashSync('AdminTest@123', 10);
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Customer Admin', 'ADMIN', 'ACTIVE', NOW(), NOW())
    `, [adminId, adminEmail, `+917${Date.now().toString().slice(-9)}`, hash]);

    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: 'AdminTest@123' });
    adminToken = adminLogin.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  it('1. Successfully creates customer with manual route (e.g. Dadri, Pari Chowk)', async () => {
    const res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Ramesh Verma',
        primaryPhone: `+918${Date.now().toString().slice(-9)}`,
        areaRoute: 'Pari Chowk Block B',
        addressLine1: 'Plot 45, Sector Alpha 1',
        city: 'Greater Noida',
        state: 'Uttar Pradesh',
        pincode: '201308',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.areaRoute).toBe('Pari Chowk Block B');
  });

  it('2. Edits customer route and details while EMI is active & records immutable audit log', async () => {
    // Create customer
    const custRes = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Sunita Sharma',
        primaryPhone: `+918${(Date.now() + 1).toString().slice(-9)}`,
        areaRoute: 'Kasna Village',
        addressLine1: 'House 12, Main Street',
        city: 'Greater Noida',
        state: 'Uttar Pradesh',
        pincode: '201310',
      });
    const customerId = custRes.body.data.id;

    // Update customer with new manual route
    const updateRes = await request(app)
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        areaRoute: 'Noida Sector 62',
        addressLine1: 'Tower B, Tech Zone',
        city: 'Noida',
        state: 'Uttar Pradesh',
        pincode: '201309',
        alternatePhone: '+918112233445',
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.success).toBe(true);
    expect(updateRes.body.data.areaRoute).toBe('Noida Sector 62');
    expect(updateRes.body.data.city).toBe('Noida');

    // Verify audit log
    const auditRes = await request(app)
      .get(`/api/v1/audit-logs?entityType=Customer&entityId=${customerId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(auditRes.status).toBe(200);
    const logs = auditRes.body.data.logs || auditRes.body.data;
    const updateLog = logs.find((l: any) => l.action === 'CUSTOMER_UPDATED');
    expect(updateLog).toBeDefined();
    expect(updateLog.newState.areaRoute).toBe('Noida Sector 62');
  });

  it('3. Supports multiple dynamic KYC documents upload, fetch and deletion', async () => {
    // Create customer
    const custRes = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Deepak Chopra',
        primaryPhone: `+918${(Date.now() + 2).toString().slice(-9)}`,
        areaRoute: 'Alpha 1 Commercial',
        addressLine1: 'Shop 10',
        city: 'Greater Noida',
        state: 'Uttar Pradesh',
        pincode: '201308',
      });
    const customerId = custRes.body.data.id;

    // Add 1st Document (AADHAAR)
    const presigned1 = await request(app)
      .post('/api/v1/kyc/presigned-upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        docType: KYCType.AADHAAR,
        fileName: 'aadhaar_front.jpg',
        mimeType: 'image/jpeg',
        fileSizeBytes: 102400,
      });
    expect(presigned1.status).toBe(200);

    const confirm1 = await request(app)
      .post('/api/v1/kyc/confirm')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        docType: KYCType.AADHAAR,
        docNumber: '1234-5678-9012',
        storageKey: presigned1.body.data.storageKey,
        fileMimeType: presigned1.body.data.fileMimeType,
        fileSizeBytes: presigned1.body.data.fileSizeBytes,
      });
    expect(confirm1.status).toBe(201);
    const doc1Id = confirm1.body.data.id;

    // Add 2nd Document (PAN)
    const presigned2 = await request(app)
      .post('/api/v1/kyc/presigned-upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        docType: KYCType.PAN,
        fileName: 'pan_card.jpg',
        mimeType: 'image/jpeg',
        fileSizeBytes: 85000,
      });
    const confirm2 = await request(app)
      .post('/api/v1/kyc/confirm')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        docType: KYCType.PAN,
        docNumber: 'ABCDE1234F',
        storageKey: presigned2.body.data.storageKey,
        fileMimeType: presigned2.body.data.fileMimeType,
        fileSizeBytes: presigned2.body.data.fileSizeBytes,
      });
    expect(confirm2.status).toBe(201);

    // Fetch customer details and verify multiple docs
    const listRes = await request(app)
      .get(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.kycDocuments.length).toBe(2);

    // Delete 1st Document
    const delRes = await request(app)
      .delete(`/api/v1/kyc/${doc1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    // Verify list after deletion
    const listAfterDel = await request(app)
      .get(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listAfterDel.body.data.kycDocuments.length).toBe(1);
    expect(listAfterDel.body.data.kycDocuments[0].docType).toBe(KYCType.PAN);
  });
});
