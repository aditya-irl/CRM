# Implementation Progress

> **Last Updated:** 2026-10-12  
> **Working-tree state:** Clean working tree. Changes partitioned into structured logical commits.

---

## Git State Summary

```
edb2543 test(api): align legacy test expectations with monthly flat rules and test isolation
8ed5e89 fix(onboarding): resolve HTTP 413, add photo retry, idempotency, and repeat financing
ce7d482 feat(portal): secure customer portal KYC document viewing with token isolation
a4c0ccb feat(storage): path-traversal hardening and KYC document lifecycle
76c9753 feat(finance): monthly flat dealer interest rate validation (4%, 5%, 6%)
5eeac06 build(dx): concurrent workspace development startup
92a0030 fix(kyc): remove auto-upload side-effect in confirmKYCDocument
```

---

## Change Inventory by Feature Group

---

### Group 1 — Local Development / Startup

**Files:**
- `package.json`
- `package-lock.json`

**What the diff implements:**
- Replaces broken sequential workspace startup with `concurrently -k -n shared,api,web` running shared watch, API, and Vite dev servers in parallel.
- Adds `dev:web` and `dev:api` convenience scripts.
- Installs `concurrently ^9.2.5`.

**Status:** Verified working — API and frontend start and run concurrently.

---

### Group 2 — Dealer Interest Rate Enforcement

**Files:**
- `packages/shared/src/financial.ts`
- `packages/shared/src/financial.test.ts`
- `apps/api/src/modules/customers/customers.service.ts`
- `apps/api/src/modules/loans/loans.service.ts`
- `apps/api/src/modules/loans/loans.routes.ts`
- `apps/web/src/components/AddCustomerWizard.tsx`

**What the diff implements:**
- Exports `DEALER_ALLOWED_INTEREST_RATES = [4, 5, 6] as const` (monthly simple flat rates).
- Backend enforces that dealer-originated loans only permit 4%, 5%, or 6% monthly flat rate; rejects other rates (e.g. 3% or 15%), non-monthly frequencies, and reducing balance calculations with HTTP 400.
- Frontend renders a constrained rate selector for dealer accounts.

**Test Evidence:**
- `financial.test.ts`: 30/30 passed.
- `customer_onboarding_payload_limits.integration.test.ts`: Dealer rate restrictions, frequency checks, and calc method checks verified (HTTP 400 on violations, HTTP 201 on valid rates).

---

### Group 3 — KYC / Storage / Document Re-upload & Hardening

**Files:**
- `apps/api/src/core/storage/local.storage.ts`
- `apps/api/src/core/storage/s3.storage.ts`
- `apps/api/src/modules/kyc/kyc.service.ts`
- `apps/api/src/modules/kyc/kyc.routes.ts`
- `apps/web/src/components/DocumentViewerModal.tsx`
- `apps/api/tests/storage_vault_and_kyc_lifecycle.integration.test.ts`
- `apps/api/tests/storage_config_enforcement.test.ts`

**What the diff implements:**
- Local & S3 storage providers: Path traversal security (`../`, Windows backslashes, absolute paths, null bytes) strictly rejected across `upload`, `delete`, `exists`, `getStream`, `getSignedUrl`.
- Leading slashes normalized.
- Diagnostic correlation logging on missing objects without leaking secrets (`404 DOCUMENT_FILE_MISSING`).
- Safe re-upload and replacement lifecycle (`initReuploadKYCDocument` / `confirmReplacementKYCDocument`).
- Document viewer modal supports both admin JWT downloads and customer portal token downloads.

**Test Evidence:**
- `storage_vault_and_kyc_lifecycle.integration.test.ts`: 10/10 passed.
- `storage_config_enforcement.test.ts`: 26/26 passed.

---

### Group 4 — Customer Portal KYC Document Exposure & Security

**Files:**
- `apps/api/src/modules/portal/portal.routes.ts`
- `apps/api/src/modules/portal/portal.service.ts`
- `apps/web/src/services/api.ts`
- `apps/web/src/views/CustomerPortalView.tsx`
- `apps/api/tests/portal_kyc_security.integration.test.ts`

**What the diff implements:**
- 3 public portal endpoints authenticated via opaque portal token (`cpt_...`): `GET /api/v1/portal/kyc`, `GET /api/v1/portal/kyc/:id/presigned-download`, and `GET /api/v1/portal/kyc/:id/view`.
- Strict IDOR and borrower ownership enforcement.
- Safe browser streaming with `X-Content-Type-Options: nosniff`.
- Immediate access revocation when portal links are revoked.
- UI tab in `CustomerPortalView` displaying document list and view modal.

**Test Evidence:**
- `portal_kyc_security.integration.test.ts`: 10/10 passed.

---

### Group 5 — Customer Onboarding HTTP 413, Photo Failure Handling & Idempotency

**Files:**
- `apps/web/src/components/AddCustomerWizard.tsx`
- `apps/web/src/components/EditCustomerModal.tsx`
- `apps/web/src/services/api.ts`
- `packages/shared/src/validation.ts`
- `apps/api/src/modules/customers/customers.routes.ts`
- `apps/api/src/modules/customers/customers.service.ts`
- `apps/api/tests/customer_onboarding_payload_limits.integration.test.ts`

**What the diff implements:**
1. **HTTP 413 Resolution:** Omitted multi-megabyte Base64 image strings from `POST /api/v1/customers/onboard` JSON payload; photo is uploaded separately as binary stream via the secure KYC storage vault after atomic customer/loan booking.
2. **Photo Failure Handling in Wizard:**
   - If photo upload fails after customer creation, the UI displays partial success warning (*"Borrower Created (Photo Upload Pending)"*) with failure reason.
   - Provides a dedicated *"Retry Photo Upload"* button (`handleRetryPhotoUpload`) that retries KYC upload for the created customer ID without calling `onboardCustomer` again.
   - Prevents duplicate customer or loan creation.
3. **Edit Customer Photo Failure Handling:**
   - In `EditCustomerModal.tsx`, failing photo uploads throw an explicit error caught in `errorMsg`.
   - Prevents saving broken or empty URLs and preserves the existing customer photo reference.
4. **Onboarding Idempotency & Concurrency Hardening:**
   - Backend accepts `Idempotency-Key` or `X-Idempotency-Key` header and payload `idempotencyKey`.
   - **Concurrency Synchronization:** Uses PostgreSQL transaction-scoped advisory locks (`pg_advisory_xact_lock(hashtext('onboard:' || key))`) inside `runPostgresTransaction`. Serializes simultaneous requests with the same key, eliminating duplicate customer and loan race conditions.
   - **Payload Fingerprint Validation:** Caches and validates primary phone, full name, principal amount, down payment, interest rate, and tenure. Conflicting parameters throw HTTP 409 Conflict.
   - **Secondary Deduplication & Legitimate Re-financing:** Natural deduplication guard detects identical customer creation retried without explicit headers within a 2-minute window. Guarded with `if (!idempotencyKey)` so distinct `Idempotency-Key` values permit legitimate new financing requests even when the borrower and loan terms match an earlier request.
   - **Transaction Isolation:** Idempotency records stored in `system_settings` inside `runPostgresTransaction`; rollbacks cleanly purge idempotency records if transaction fails.
   - Idempotency key recorded in immutable `audit_logs`.

**Test Evidence:**
- `customer_onboarding_payload_limits.integration.test.ts`: 19/19 passed (including concurrent request race test, financial payload conflict test, repeat financing with distinct Idempotency-Key, and ₹10k 4% monthly flat schedule verification).
- `customer_edit_and_kyc.test.ts`: 3/3 passed.

---

### Group 6 — Legacy Test Suites & Test Isolation Alignment

**Files:**
- `apps/api/tests/mobile_workflow.integration.test.ts`
- `apps/api/tests/uat_onboarding_dealer_portal.integration.test.ts`
- `apps/api/tests/api.integration.test.ts`
- `apps/api/tests/phase2.real_integration.test.ts`
- `apps/api/tests/phase4.real_integration.test.ts`
- `apps/api/tests/midnight_engine_and_dealer_approval.integration.test.ts`
- `apps/api/tests/dealer_approval_and_monthly_flat_analytics.integration.test.ts`
- `apps/api/tests/device_and_penalty_fixes.test.ts`
- `apps/api/tests/storage_config_enforcement.test.ts`

**What was addressed:**
1. **Financial Formula Alignment:** Aligned legacy tests with the confirmed monthly flat interest formula ($\text{Monthly Interest} = P \times r/100$, $\text{Total Interest} = \text{Monthly Interest} \times \text{Tenure}$, $\text{Total Payable} = P + \text{Total Interest}$, $\text{EMI} = \text{Total Payable} / \text{Tenure}$).
2. **Dealer Rate Restrictions:** Replaced obsolete dealer rates (1%, 1.2%, 1.5%, 14%, 15%) in valid workflow fixtures with allowed dealer monthly rates (4%, 5%, 6%), while maintaining explicit rejection assertions for unsupported rates (e.g., 14%, 15%).
3. **Workflow State Machine Alignment:** In UAT and Dealer tests, dealer-originated loans are properly transitioned through admin approval and disbursement before checking active EMI schedules or portal payments.
4. **Test Isolation & Resource Lifecycle:**
   - Removed premature `closePostgresPool()` and `closeRedisConnection()` calls from `afterAll` in individual test files, preserving singleton connections across Jest `--runInBand` test runs.
   - Handled temporary file unlinking and stream lifecycle in storage tests so async streaming doesn't trigger unhandled `ENOENT` events.

---

## Test Execution Summary

| Test Suite | Area Covered | Tests Passed | Status |
|---|---|---|---|
| `apps/api` (All 49 Suites) | Complete API integration test suite | 773 / 773 | **PASS** |
| `packages/shared` (All 2 Suites) | Financial math, validations, dealer rules | 47 / 47 | **PASS** |
| `customer_onboarding_payload_limits.integration.test.ts` | Onboarding limits, HTTP 413, Concurrency, Idempotency, Distinct key re-financing, Dealer rates | 19 / 19 | **PASS** |
| `uat_onboarding_dealer_portal.integration.test.ts` | Repaired onboarding, flat rate calculations, dealer rate rejection & RLAC | 17 / 17 | **PASS** |
| `mobile_workflow.integration.test.ts` | Mobile recovery workflow, safe PDF handling, payments | 22 / 22 | **PASS** |
| `api.integration.test.ts` | Core API workflow & monthly flat loan amortization | 10 / 10 | **PASS** |
| `phase2.real_integration.test.ts` | Loan origination, calculation preview, RLAC | 16 / 16 | **PASS** |
| `phase4.real_integration.test.ts` | Payment allocations, waterfall, reversals, concurrency | 17 / 17 | **PASS** |
| `midnight_engine_and_dealer_approval.integration.test.ts` | Midnight job execution, dealer loan approvals | 13 / 13 | **PASS** |
| `dealer_approval_and_monthly_flat_analytics.integration.test.ts` | Dealer approval workflow, monthly flat analytics | 12 / 12 | **PASS** |
| `device_and_penalty_fixes.test.ts` | Device info preservation, dealer rate rejection, penalties | 11 / 11 | **PASS** |
| `storage_vault_and_kyc_lifecycle.integration.test.ts` | Storage vault, presigned URLs, re-upload, deletion | 10 / 10 | **PASS** |
| `portal_kyc_security.integration.test.ts` | Portal token auth, IDOR protection, link revocation | 10 / 10 | **PASS** |
| `storage_config_enforcement.test.ts` | Production guards, path traversal security, leak protection | 26 / 26 | **PASS** |
| `@crm/web build` | TypeScript compilation & Vite production build | Complete | **PASS** |
| `@crm/api build` | TypeScript compilation & runtime dist resolution | Complete | **PASS** |

---

## Environment Considerations

1. Production S3 encryption (`ServerSideEncryption: 'AES256'`) requires active AWS S3/R2/MinIO credentials; in local development and automated testing, the hardened `local` storage provider is utilized.
