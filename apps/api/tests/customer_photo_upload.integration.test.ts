import request from 'supertest';
import app from '../src/app';
import { queryPostgres } from '../src/database/postgres';
import { getStorageProvider } from '../src/core/storage';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../src/middlewares/auth.middleware';

describe('Customer Photo Upload & Retrieval Flow (Regression Tests)', () => {
  let adminId: string;
  let adminToken: string;

  let branchManagerId: string;
  let branchManagerToken: string;

  let dealerId: string;
  let dealerUserId: string;
  let dealerToken: string;

  let otherDealerId: string;
  let otherDealerUserId: string;
  let otherDealerToken: string;

  let customerId: string;
  let otherCustomerId: string;

  // Synthetic valid JPEG header
  const validJpegBuffer = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x60, 0x00, 0x60, 0x00, 0x00, 0xFF, 0xD9
  ]);
  const validJpegBase64 = validJpegBuffer.toString('base64');

  // Synthetic valid PNG header
  const validPngBuffer = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52
  ]);
  const validPngBase64 = validPngBuffer.toString('base64');

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    const runId = Math.random().toString(36).substring(2, 7);

    // 1. Admin
    adminId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, password_hash, role, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'ADMIN', 'Photo Test Admin', 'ACTIVE', NOW(), NOW())`,
      [adminId, `photo_admin_${runId}@crm.test`, hash]
    );
    adminToken = jwt.sign({ id: adminId }, JWT_SECRET, { expiresIn: '1h' });

    // 2. Branch Manager
    branchManagerId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, password_hash, role, full_name, assigned_branch, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'BRANCH_MANAGER', 'Photo Test BM', 'North Zone', 'ACTIVE', NOW(), NOW())`,
      [branchManagerId, `photo_bm_${runId}@crm.test`, hash]
    );
    branchManagerToken = jwt.sign({ id: branchManagerId }, JWT_SECRET, { expiresIn: '1h' });

    // 3. Primary Dealer
    dealerId = uuidv4();
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, status, area_city, address, created_at, updated_at)
       VALUES ($1, $2, 'Primary Photo Store', 'Owner 1', $3, $4, 'ACTIVE', 'North Zone', 'Shop 101', NOW(), NOW())`,
      [dealerId, `DLR_PH_1_${runId}`, `9876${Date.now().toString().slice(-6)}`, `dlr_ph1_${runId}@crm.test`]
    );
    dealerUserId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, password_hash, role, full_name, status, dealer_id, assigned_branch, created_at, updated_at)
       VALUES ($1, $2, $3, 'DEALER', 'Photo Dealer User 1', 'ACTIVE', $4, 'North Zone', NOW(), NOW())`,
      [dealerUserId, `dealer_ph1_${runId}@crm.test`, hash, dealerId]
    );
    dealerToken = jwt.sign({ id: dealerUserId }, JWT_SECRET, { expiresIn: '1h' });

    // 4. Secondary Dealer
    otherDealerId = uuidv4();
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, status, area_city, address, created_at, updated_at)
       VALUES ($1, $2, 'Other Photo Store', 'Owner 2', $3, $4, 'ACTIVE', 'South Zone', 'Shop 202', NOW(), NOW())`,
      [otherDealerId, `DLR_PH_2_${runId}`, `9875${Date.now().toString().slice(-6)}`, `dlr_ph2_${runId}@crm.test`]
    );
    otherDealerUserId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, password_hash, role, full_name, status, dealer_id, assigned_branch, created_at, updated_at)
       VALUES ($1, $2, $3, 'DEALER', 'Photo Dealer User 2', 'ACTIVE', $4, 'South Zone', NOW(), NOW())`,
      [otherDealerUserId, `dealer_ph2_${runId}@crm.test`, hash, otherDealerId]
    );
    otherDealerToken = jwt.sign({ id: otherDealerUserId }, JWT_SECRET, { expiresIn: '1h' });

    // 5. Customers
    customerId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_by, created_at, updated_at)
       VALUES ($1, $2, 'Rohan Sharma', $3, '123 Civil Lines', 'North Zone', 'UP', '201301', 'Route 1', $4, NOW(), NOW())`,
      [customerId, `CUST_PH1_${runId}`, `9811${Date.now().toString().slice(-6)}`, dealerUserId]
    );

    otherCustomerId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_by, created_at, updated_at)
       VALUES ($1, $2, 'Vikas Verma', $3, '456 Ring Road', 'South Zone', 'Delhi', '110001', 'Route 2', $4, NOW(), NOW())`,
      [otherCustomerId, `CUST_PH2_${runId}`, `9812${Date.now().toString().slice(-6)}`, otherDealerUserId]
    );
  });

  afterAll(async () => {
    // Clean up test records (audit_logs are immutable by DB trigger, so users are retained)
    await queryPostgres('DELETE FROM kyc_documents WHERE customer_id IN ($1, $2)', [customerId, otherCustomerId]);
    await queryPostgres('DELETE FROM customers WHERE id IN ($1, $2)', [customerId, otherCustomerId]);
  });

  // Test 1: Valid device-selected JPEG upload
  it('1. Uploads valid device-selected JPEG photo successfully', async () => {
    const res = await request(app)
      .post(`/api/v1/customers/${customerId}/photo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fileName: 'customer_selected.jpeg',
        mimeType: 'image/jpeg',
        fileBase64: validJpegBase64,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.photoUrl).toBe(`/api/v1/customers/${customerId}/photo`);
    expect(res.body.data.customer.id).toBe(customerId);
    expect(res.body.data.customer.photoUrl).toBe(`/api/v1/customers/${customerId}/photo`);
  });

  // Test 2: Valid camera-captured image upload (e.g. mobile camera outputting image/jpg or missing extension)
  it('2. Normalizes and uploads camera-captured image (image/jpg / generic name) successfully', async () => {
    const res = await request(app)
      .post(`/api/v1/customers/${customerId}/photo`)
      .set('Authorization', `Bearer ${dealerToken}`)
      .send({
        fileName: 'camera_capture',
        mimeType: 'image/jpg',
        fileBase64: validJpegBase64,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.photoUrl).toBe(`/api/v1/customers/${customerId}/photo`);
  });

  // Test 3: Unsupported MIME types (text/plain, application/pdf, image/gif)
  it('3. Rejects unsupported MIME types with HTTP 400', async () => {
    // 3a. text/plain
    const textRes = await request(app)
      .post(`/api/v1/customers/${customerId}/photo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        fileBase64: Buffer.from('hello text').toString('base64'),
      });
    expect([400, 422]).toContain(textRes.status);

    // 3b. application/pdf (not allowed for photo)
    const pdfRes = await request(app)
      .post(`/api/v1/customers/${customerId}/photo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fileName: 'document.pdf',
        mimeType: 'application/pdf',
        fileBase64: Buffer.from('%PDF-1.4').toString('base64'),
      });
    expect([400, 422]).toContain(pdfRes.status);

    // 3c. image/gif (unsupported photo mime)
    const gifRes = await request(app)
      .post(`/api/v1/customers/${customerId}/photo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fileName: 'animation.gif',
        mimeType: 'image/gif',
        fileBase64: Buffer.from('GIF89a').toString('base64'),
      });
    expect([400, 422]).toContain(gifRes.status);
  });

  // Test 4: Oversized images (> 10MB)
  it('4. Rejects oversized images (> 10MB) with HTTP 400/413/422', async () => {
    // 11MB payload
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024, 0xFF);
    const largeBase64 = largeBuffer.toString('base64');

    const res = await request(app)
      .post(`/api/v1/customers/${customerId}/photo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fileName: 'huge.jpg',
        mimeType: 'image/jpeg',
        fileBase64: largeBase64,
      });

    expect([400, 413, 422]).toContain(res.status);
  });

  // Test 5: Malformed base64 or invalid image data (magic bytes mismatch)
  it('5. Rejects invalid image magic bytes with HTTP 400/422', async () => {
    const fakeData = Buffer.from('Not a real image binary string');
    const fakeBase64 = fakeData.toString('base64');

    const res = await request(app)
      .post(`/api/v1/customers/${customerId}/photo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fileName: 'corrupt.jpg',
        mimeType: 'image/jpeg',
        fileBase64: fakeBase64,
      });

    expect([400, 422]).toContain(res.status);
    const errMsg = res.body.error?.message || res.body.message || '';
    expect(errMsg).toMatch(/content does not match/i);
  });

  // Test 6: Unauthorized uploads
  it('6. Rejects unauthenticated uploads with HTTP 401', async () => {
    const noTokenRes = await request(app)
      .post(`/api/v1/customers/${customerId}/photo`)
      .send({
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        fileBase64: validJpegBase64,
      });
    expect(noTokenRes.status).toBe(401);

    const badTokenRes = await request(app)
      .post(`/api/v1/customers/${customerId}/photo`)
      .set('Authorization', 'Bearer invalid-jwt-token')
      .send({
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        fileBase64: validJpegBase64,
      });
    expect(badTokenRes.status).toBe(401);
  });

  // Test 7: Correct customer ownership and RLAC enforcement
  it('7. Enforces customer ownership & RLAC (cross-dealer denied, authorized dealer allowed)', async () => {
    // 7a. Dealer 2 attempting to upload photo for Dealer 1 customer -> 403 Forbidden
    const crossDealerRes = await request(app)
      .post(`/api/v1/customers/${customerId}/photo`)
      .set('Authorization', `Bearer ${otherDealerToken}`)
      .send({
        fileName: 'unauthorized_dlr2.jpg',
        mimeType: 'image/jpeg',
        fileBase64: validJpegBase64,
      });
    expect(crossDealerRes.status).toBe(403);
    const crossMsg = crossDealerRes.body.error?.message || crossDealerRes.body.message || '';
    expect(crossMsg).toMatch(/access to this customer|forbidden|access denied/i);

    // 7b. Dealer 1 uploading for their own customer -> 201 Created
    const ownDealerRes = await request(app)
      .post(`/api/v1/customers/${customerId}/photo`)
      .set('Authorization', `Bearer ${dealerToken}`)
      .send({
        fileName: 'authorized_dlr1.jpg',
        mimeType: 'image/jpeg',
        fileBase64: validJpegBase64,
      });
    expect(ownDealerRes.status).toBe(201);
    expect(ownDealerRes.body.success).toBe(true);

    // 7c. Branch Manager uploading for customer in their branch -> 201 Created
    const bmRes = await request(app)
      .post(`/api/v1/customers/${customerId}/photo`)
      .set('Authorization', `Bearer ${branchManagerToken}`)
      .send({
        fileName: 'bm_photo.jpg',
        mimeType: 'image/jpeg',
        fileBase64: validJpegBase64,
      });
    expect(bmRes.status).toBe(201);
  });

  // Test 8: Successful storage and database reference persistence
  it('8. Successfully persists storage key in customers.photo_url and creates kyc_documents record', async () => {
    const uploadRes = await request(app)
      .post(`/api/v1/customers/${customerId}/photo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fileName: 'avatar.png',
        mimeType: 'image/png',
        fileBase64: validPngBase64,
      });

    expect(uploadRes.status).toBe(201);

    // Verify DB state
    const customerRow = await queryPostgres(
      'SELECT photo_url FROM customers WHERE id = $1',
      [customerId]
    );
    expect(customerRow.rows.length).toBe(1);
    const storedKey = customerRow.rows[0].photo_url;
    // Must be stored as canonical private storage key, not a temporary presigned URL!
    expect(storedKey).toMatch(/^photos\/[0-9a-f-]+\/[0-9a-f-]+\.png$/);

    // Verify storage object actually exists in the storage provider
    const storage = getStorageProvider();
    const exists = await storage.exists(storedKey);
    expect(exists).toBe(true);

    // Verify kyc_documents PHOTO record was created
    const kycRow = await queryPostgres(
      `SELECT doc_type, storage_key, status FROM kyc_documents WHERE customer_id = $1 AND doc_type = 'PHOTO' ORDER BY created_at DESC LIMIT 1`,
      [customerId]
    );
    expect(kycRow.rows.length).toBe(1);
    expect(kycRow.rows[0].storage_key).toBe(storedKey);
  });

  // Test 9: Retrieval of uploaded photo through the authorized endpoint
  it('9. Streams uploaded photo via Bearer token and via ?token= query parameter', async () => {
    // 9a. Bearer token access
    const bearerRes = await request(app)
      .get(`/api/v1/customers/${customerId}/photo`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(bearerRes.status).toBe(200);
    expect(bearerRes.headers['content-type']).toBe('image/png');
    expect(bearerRes.body).toEqual(validPngBuffer);

    // 9b. Browser <img> ?token= query param access
    const queryTokenRes = await request(app)
      .get(`/api/v1/customers/${customerId}/photo?token=${dealerToken}`);

    expect(queryTokenRes.status).toBe(200);
    expect(queryTokenRes.headers['content-type']).toBe('image/png');
    expect(queryTokenRes.body).toEqual(validPngBuffer);

    // 9c. Cross-dealer retrieval denied
    const crossDealerGet = await request(app)
      .get(`/api/v1/customers/${customerId}/photo?token=${otherDealerToken}`);
    expect(crossDealerGet.status).toBe(403);

    // 9d. Unauthenticated retrieval denied
    const unauthGet = await request(app)
      .get(`/api/v1/customers/${customerId}/photo`);
    expect(unauthGet.status).toBe(401);

    // 9e. Customer with no photo returns 404
    const noPhotoRes = await request(app)
      .get(`/api/v1/customers/${otherCustomerId}/photo`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(noPhotoRes.status).toBe(404);
  });

  // Test 10: Existing KYC document upload pipeline remains functional
  it('10. Confirms existing KYC document direct upload pipeline remains fully functional', async () => {
    const samplePdfBuffer = Buffer.from('%PDF-1.4 Test KYC Document Content');
    const kycRes = await request(app)
      .post('/api/v1/kyc/direct-upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        docType: 'AADHAAR',
        docNumber: '1234-5678-9012',
        fileName: 'aadhaar_card.pdf',
        mimeType: 'application/pdf',
        fileBase64: samplePdfBuffer.toString('base64'),
      });

    expect(kycRes.status).toBe(201);
    expect(kycRes.body.success).toBe(true);
    expect(kycRes.body.data.id).toBeDefined();

    // Verify storage object exists
    const docRow = await queryPostgres('SELECT storage_key FROM kyc_documents WHERE id = $1', [kycRes.body.data.id]);
    expect(docRow.rows.length).toBe(1);
    const kycStorageKey = docRow.rows[0].storage_key;
    expect(kycStorageKey).toMatch(/^kyc\/[0-9a-f-]+\/[0-9a-f-]+\.pdf$/);

    const storage = getStorageProvider();
    const exists = await storage.exists(kycStorageKey);
    expect(exists).toBe(true);
  });
});
