import { v4 as uuidv4 } from 'uuid';
import { queryPostgres, runPostgresTransaction } from '../../database/postgres';
import { db } from '../../database/db';
import { UserRole, maskPhone, maskAadhaar, maskPan, generateAmortizationSchedule, LoanStatus, OnboardCustomerInput } from '@crm/shared';
import { AppError, NotFoundError, ForbiddenError } from '../../middlewares/error.middleware';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { AuditService } from '../audit/audit.service';

export interface CreateCustomerDTO {
  fullName: string;
  primaryPhone: string;
  alternatePhone?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  landmark?: string | null;
  city: string;
  state: string;
  pincode: string;
  areaRoute: string;
  photoUrl?: string | null;
}

export interface UpdateCustomerDTO extends Partial<CreateCustomerDTO> {
  isActive?: boolean;
}

export class CustomerService {
  /**
   * List customers with pagination, search, route filter, and agent RLAC scoping.
   */
  public static async listCustomers(
    user: AuthenticatedUser,
    query: { page?: number; limit?: number; search?: string; route?: string; status?: string }
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const offset = (page - 1) * limit;

    let sql = `
      SELECT c.*,
             (SELECT COUNT(*) FROM loans l WHERE l.customer_id = c.id AND l.status = 'ACTIVE') as active_loans_count,
             (SELECT COALESCE(SUM(l.outstanding_balance), 0) FROM loans l WHERE l.customer_id = c.id AND l.status = 'ACTIVE') as total_outstanding
      FROM customers c
      WHERE c.deleted_at IS NULL
    `;
    const params: any[] = [];
    let paramIndex = 1;

    // Dealer Row-Level Scoping: Dealer sees customers with loans through their store OR customers created by this dealer
    if (user.role === UserRole.DEALER) {
      if (!user.dealerId) {
        throw new ForbiddenError('Dealer context missing');
      }
      sql += ` AND (
        c.id IN (SELECT customer_id FROM loans WHERE dealer_id = $${paramIndex})
        OR c.created_by = $${paramIndex + 1}
      )`;
      params.push(user.dealerId, user.id);
      paramIndex += 2;
    } else if (user.role === UserRole.COLLECTION_AGENT) {
      // Role-based scoping: Field collection agents only see customers assigned to them or their route
      sql += ` AND (
        c.id IN (
          SELECT customer_id FROM collection_assignments 
          WHERE agent_id = $${paramIndex} AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
        )
        OR c.area_route IN (
          SELECT area_route FROM collection_assignments 
          WHERE agent_id = $${paramIndex} AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
        )
      )`;
      params.push(user.id);
      paramIndex++;
    }

    if (query.route) {
      sql += ` AND c.area_route = $${paramIndex++}`;
      params.push(query.route);
    }

    if (query.status === 'active') {
      sql += ` AND c.is_active = TRUE`;
    } else if (query.status === 'inactive') {
      sql += ` AND c.is_active = FALSE`;
    }

    if (query.search) {
      sql += ` AND (c.full_name ILIKE $${paramIndex} OR c.primary_phone ILIKE $${paramIndex} OR c.customer_code ILIKE $${paramIndex})`;
      params.push(`%${query.search}%`);
      paramIndex++;
    }

    // Get total count
    const countSql = `SELECT COUNT(*) as total FROM (${sql}) sub`;
    const countRes = await queryPostgres<{ total: string }>(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    sql += ` ORDER BY c.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await queryPostgres(sql, params);

    return {
      customers: result.rows.map((c: any) => ({
        id: c.id,
        customerCode: c.customer_code,
        fullName: c.full_name,
        primaryPhone: c.primary_phone,
        alternatePhone: c.alternate_phone,
        addressLine1: c.address_line1,
        addressLine2: c.address_line2,
        landmark: c.landmark,
        city: c.city,
        state: c.state,
        pincode: c.pincode,
        areaRoute: c.area_route,
        photoUrl: c.photo_url,
        isActive: Boolean(c.is_active),
        activeLoansCount: Number(c.active_loans_count || 0),
        totalOutstanding: Number(c.total_outstanding || 0),
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Retrieve customer by ID with strict Row-Level Access Control (RLAC) to prevent IDOR.
   */
  public static async getCustomerById(id: string, user: AuthenticatedUser) {
    const custRes = await queryPostgres(
      'SELECT * FROM customers WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (custRes.rows.length === 0) {
      throw new NotFoundError('Customer not found');
    }

    const customer = custRes.rows[0];

    // RLAC: Check dealer scoping or agent assignment permission (IDOR protection)
    if (user.role === UserRole.DEALER) {
      if (!user.dealerId) {
        throw new ForbiddenError('Dealer context missing');
      }
      const dealerLoanRes = await queryPostgres(
        `SELECT id FROM loans WHERE dealer_id = $1 AND customer_id = $2
         UNION
         SELECT id FROM customers WHERE id = $2 AND created_by = $3`,
        [user.dealerId, customer.id, user.id]
      );
      if (dealerLoanRes.rows.length === 0) {
        throw new ForbiddenError('You do not have access to this customer profile');
      }
    } else if (user.role === UserRole.COLLECTION_AGENT) {
      const assignmentRes = await queryPostgres(
        `SELECT id FROM collection_assignments
         WHERE agent_id = $1 AND (customer_id = $2 OR area_route = $3) 
           AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
         UNION
         SELECT id FROM loans WHERE customer_id = $2 AND assigned_agent_id = $1`,
        [user.id, customer.id, customer.area_route]
      );

      if (assignmentRes.rows.length === 0) {
        throw new ForbiddenError('You do not have access to this customer profile');
      }
    }

    // Get active and historical loans with linked dealer information
    let loansSql = `
      SELECT l.*, d.store_name as dealer_store_name, d.dealer_code
      FROM loans l
      LEFT JOIN dealers d ON l.dealer_id = d.id
      WHERE l.customer_id = $1
    `;
    const loansParams: any[] = [id];
    if (user.role === UserRole.DEALER) {
      loansSql += ' AND l.dealer_id = $2';
      loansParams.push(user.dealerId);
    } else if (user.role === UserRole.COLLECTION_AGENT) {
      loansSql += ' AND l.assigned_agent_id = $2';
      loansParams.push(user.id);
    }
    loansSql += ' ORDER BY l.created_at DESC';

    const loansRes = await queryPostgres(loansSql, loansParams);

    // Fetch all installments for these loans to provide complete financing and payment metrics
    const loanIds = loansRes.rows.map((r: any) => r.id);
    let allInstallments: any[] = [];
    if (loanIds.length > 0) {
      const instRes = await queryPostgres(
        `SELECT * FROM emi_installments WHERE loan_id = ANY($1) ORDER BY installment_number ASC`,
        [loanIds]
      );
      allInstallments = instRes.rows;
    }

    // Get KYC documents (Masked for collection agents, raw storage keys hidden)
    const kycRes = await queryPostgres(
      'SELECT * FROM kyc_documents WHERE customer_id = $1 ORDER BY created_at DESC',
      [id]
    );

    const hideKey = user.role === UserRole.COLLECTION_AGENT || user.role === UserRole.DEALER;

    const kycSanitized = kycRes.rows.map((doc: any) => ({
      id: doc.id,
      docType: doc.doc_type,
      docNumberMasked: doc.doc_number_masked,
      status: doc.status,
      verifiedAt: doc.verified_at,
      storageKey: hideKey ? undefined : doc.storage_key, // hide raw S3 key from agents and dealers
      fileMimeType: doc.file_mime_type,
      fileSizeBytes: Number(doc.file_size_bytes),
      createdAt: doc.created_at,
    }));

    // Get recent call logs
    const callLogsRes = await queryPostgres(
      `SELECT cl.*, u.full_name as agent_name
       FROM call_logs cl
       JOIN users u ON cl.agent_id = u.id
       WHERE cl.customer_id = $1
       ORDER BY cl.call_timestamp DESC
       LIMIT 10`,
      [id]
    );

    const loans = loansRes.rows.map((l: any) => {
      const loanInsts = allInstallments.filter((inst) => inst.loan_id === l.id);
      const nextInst = loanInsts.find((inst) => inst.status === 'UPCOMING' || inst.status === 'DUE_TODAY' || inst.status === 'OVERDUE');
      const overdueInsts = loanInsts.filter((inst) => inst.status === 'OVERDUE');
      const maxDaysOverdue = overdueInsts.length > 0 ? Math.max(...overdueInsts.map((i) => Number(i.days_overdue || 0))) : 0;
      const totalPenalty = loanInsts.reduce((sum, i) => sum + Number(i.penalty_amount || 0), 0);
      const retailPrice = Number(l.principal_amount);
      const downPayment = Number(l.down_payment || 0);
      const financedAmount = Number(l.net_disbursed_amount || (retailPrice - downPayment));
      const totalPayable = Number(l.total_payable);
      const totalPaid = Number(l.total_paid);
      const pendingAmount = Math.max(0, totalPayable - totalPaid);

      const rawBrand = l.device_brand || null;
      const rawModel = l.device_model || null;
      const rawName = l.device_name || (rawBrand && rawModel ? `${rawBrand} ${rawModel}` : (rawBrand || rawModel || null));
      const rawImei1 = l.imei1 || null;
      const rawImei2 = l.imei2 || null;
      const rawStatus = l.device_status || (rawBrand || rawModel ? 'ACTIVE' : null);

      return {
        id: l.id,
        loanAccountNo: l.loan_account_no,
        dealerId: l.dealer_id,
        dealerStoreName: l.dealer_store_name || null,
        dealerCode: l.dealer_code || null,
        financingSource: l.dealer_id ? 'DEALER' : 'DIRECT',
        deviceBrand: rawBrand,
        device_brand: rawBrand,
        deviceModel: rawModel,
        device_model: rawModel,
        deviceName: rawName,
        device_name: rawName,
        imei1: rawImei1,
        imei_1: rawImei1,
        imei2: rawImei2,
        imei_2: rawImei2,
        deviceStatus: rawStatus,
        device_status: rawStatus,
        retailPrice,
        downPayment,
        financedAmount,
        principalAmount: retailPrice,
        netDisbursedAmount: financedAmount,
        annualInterestRate: Number(l.annual_interest_rate),
        tenureMonths: Number(l.tenure_months),
        installmentFrequency: l.installment_frequency,
        emiAmount: Number(l.emi_amount),
        totalInterest: Number(l.total_interest),
        totalPayable,
        totalPaid,
        outstandingBalance: Number(l.outstanding_balance),
        pendingAmount,
        nextEmiDate: nextInst ? (nextInst.due_date instanceof Date ? nextInst.due_date.toISOString().split('T')[0] : String(nextInst.due_date).split('T')[0]) : null,
        nextEmiAmount: nextInst ? Number(nextInst.expected_amount) : 0,
        overdueCount: overdueInsts.length,
        daysOverdue: maxDaysOverdue,
        penaltyAmount: totalPenalty,
        status: l.status,
        disbursementDate: l.disbursement_date instanceof Date ? l.disbursement_date.toISOString().split('T')[0] : (l.disbursement_date ? String(l.disbursement_date).split('T')[0] : l.disbursement_date),
        firstEmiDate: l.first_emi_date instanceof Date ? l.first_emi_date.toISOString().split('T')[0] : (l.first_emi_date ? String(l.first_emi_date).split('T')[0] : l.first_emi_date),
        maturityDate: l.maturity_date instanceof Date ? l.maturity_date.toISOString().split('T')[0] : (l.maturity_date ? String(l.maturity_date).split('T')[0] : l.maturity_date),
        installments: loanInsts.map((inst) => ({
          id: inst.id,
          loanId: inst.loan_id,
          installmentNumber: Number(inst.installment_number),
          dueDate: inst.due_date instanceof Date ? inst.due_date.toISOString().split('T')[0] : String(inst.due_date).split('T')[0],
          expectedAmount: Number(inst.expected_amount),
          paidAmount: Number(inst.paid_amount),
          remainingAmount: Number(inst.remaining_amount),
          penaltyAmount: Number(inst.penalty_amount || 0),
          status: inst.status,
          daysOverdue: Number(inst.days_overdue || 0),
        })),
      };
    });

    return {
      customer: {
        id: customer.id,
        customerCode: customer.customer_code,
        fullName: customer.full_name,
        primaryPhone: customer.primary_phone,
        alternatePhone: customer.alternate_phone,
        addressLine1: customer.address_line1,
        addressLine2: customer.address_line2,
        landmark: customer.landmark,
        city: customer.city,
        state: customer.state,
        pincode: customer.pincode,
        areaRoute: customer.area_route,
        photoUrl: customer.photo_url,
        isActive: Boolean(customer.is_active),
        createdAt: customer.created_at,
        updatedAt: customer.updated_at,
      },
      loans,
      kycDocuments: kycSanitized,
      callLogs: callLogsRes.rows,
    };
  }

  /**
   * Create a new customer profile (Admin / Branch Manager only).
   */
  public static async createCustomer(
    data: CreateCustomerDTO,
    user: AuthenticatedUser
  ) {
    const id = uuidv4();

    // Generate human-readable customer code
    const maxRes = await queryPostgres<{ max_num: number }>(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(customer_code FROM '[0-9]+$') AS INTEGER)), 1000) as max_num
       FROM customers WHERE customer_code ~ '^CUST-2026-[0-9]+$'`
    );
    const nextNum = (Number(maxRes.rows[0]?.max_num) || 1000) + 1;
    let customerCode = `CUST-2026-${nextNum}`;
    const existsCheck = await queryPostgres('SELECT 1 FROM customers WHERE customer_code = $1', [customerCode]);
    if (existsCheck.rows.length > 0) {
      customerCode = `CUST-2026-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 90 + 10)}`;
    }

    const sql = `
      INSERT INTO customers (
        id, customer_code, full_name, primary_phone, alternate_phone,
        address_line1, address_line2, landmark, city, state, pincode,
        area_route, photo_url, is_active, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE, $14, NOW(), NOW())
      RETURNING *
    `;

    const result = await queryPostgres(sql, [
      id,
      customerCode,
      data.fullName.trim(),
      data.primaryPhone.trim(),
      data.alternatePhone?.trim() || null,
      data.addressLine1.trim(),
      data.addressLine2?.trim() || null,
      data.landmark?.trim() || null,
      data.city.trim(),
      data.state.trim(),
      data.pincode.trim(),
      data.areaRoute.trim(),
      data.photoUrl || null,
      user.id,
    ]);

    const created = result.rows[0];

    // Sync to SQLite for legacy engine support
    try {
      let sqliteUserId = user.id;
      const userCheck = db.prepare('SELECT id FROM users WHERE id = ?').get(user.id);
      if (!userCheck) {
        const firstAdmin = db.prepare("SELECT id FROM users WHERE role IN ('SUPER_ADMIN', 'ADMIN') LIMIT 1").get() as { id: string } | undefined;
        if (firstAdmin) {
          sqliteUserId = firstAdmin.id;
        }
      }

      const createdIso = new Date(created.created_at || Date.now()).toISOString();
      const updatedIso = new Date(created.updated_at || Date.now()).toISOString();
      db.prepare(`
        INSERT INTO customers (
          id, customer_code, full_name, primary_phone, alternate_phone,
          address_line1, address_line2, landmark, city, state, pincode,
          area_route, photo_url, is_active, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(
        id, customerCode, data.fullName.trim(), data.primaryPhone.trim(),
        data.alternatePhone?.trim() || null, data.addressLine1.trim(),
        data.addressLine2?.trim() || null, data.landmark?.trim() || null,
        data.city.trim(), data.state.trim(), data.pincode.trim(),
        data.areaRoute.trim(), data.photoUrl || null, sqliteUserId,
        createdIso, updatedIso
      );
    } catch (sqliteErr) {
      // safe fallback
    }

    await AuditService.log({
      userId: user.id,
      action: 'CUSTOMER_CREATED',
      entity: 'Customer',
      entityId: id,
      newState: { customerCode, fullName: data.fullName, areaRoute: data.areaRoute },
    });

    return {
      id: created.id,
      customerCode: created.customer_code,
      fullName: created.full_name,
      primaryPhone: created.primary_phone,
      alternatePhone: created.alternate_phone,
      addressLine1: created.address_line1,
      city: created.city,
      state: created.state,
      pincode: created.pincode,
      areaRoute: created.area_route,
      isActive: Boolean(created.is_active),
      createdAt: created.created_at,
    };
  }

  /**
   * Atomic Customer + Loan Onboarding within a single database transaction.
   * If any step fails, the entire transaction rolls back cleanly, preventing partial customer or loan records.
   */
  public static async onboardCustomer(
    data: OnboardCustomerInput,
    user: AuthenticatedUser
  ) {
    return await runPostgresTransaction(async (client) => {
      // 1. Create customer
      const customerId = uuidv4();
      // Generate unique customer code using max sequence to prevent unique constraint collisions
      const maxCustRes = await client.query<{ max_num: number }>(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(customer_code FROM '[0-9]+$') AS INTEGER)), 1000) as max_num
         FROM customers WHERE customer_code ~ '^CUST-2026-[0-9]+$'`
      );
      const nextCustNum = (Number(maxCustRes.rows[0]?.max_num) || 1000) + 1;
      let customerCode = `CUST-2026-${nextCustNum}`;
      const existsCustCheck = await client.query('SELECT 1 FROM customers WHERE customer_code = $1', [customerCode]);
      if (existsCustCheck.rows.length > 0) {
        customerCode = `CUST-2026-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 90 + 10)}`;
      }

      const insertCustomerSql = `
        INSERT INTO customers (
          id, customer_code, full_name, primary_phone, alternate_phone,
          address_line1, address_line2, landmark, city, state, pincode,
          area_route, photo_url, is_active, created_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE, $14, NOW(), NOW())
        RETURNING *
      `;

      const custResult = await client.query(insertCustomerSql, [
        customerId,
        customerCode,
        data.customer.fullName.trim(),
        data.customer.primaryPhone.trim(),
        data.customer.alternatePhone?.trim() || null,
        data.customer.addressLine1.trim(),
        data.customer.addressLine2?.trim() || null,
        data.customer.landmark?.trim() || null,
        data.customer.city.trim(),
        data.customer.state.trim(),
        data.customer.pincode.trim(),
        data.customer.areaRoute.trim(),
        data.customer.photoUrl || null,
        user.id,
      ]);

      const createdCustomer = custResult.rows[0];
      let createdLoan: any = null;

      // 2. If loan data is present, create loan & EMIs atomically in the SAME transaction
      if (data.loan) {
        // Enforce Dealer RLAC: Never trust client-supplied dealerId
        let dealerId: string | null = data.loan.dealerId || null;
        if (user.role === UserRole.DEALER) {
          if (!user.dealerId) throw new ForbiddenError('Dealer context missing');
          dealerId = user.dealerId;
        }

        if (dealerId) {
          const dealerCheck = await client.query(
            'SELECT id, status FROM dealers WHERE id = $1',
            [dealerId]
          );
          if (dealerCheck.rows.length === 0) {
            throw new NotFoundError('Selected dealer not found');
          }
          if (dealerCheck.rows[0].status !== 'ACTIVE') {
            throw new AppError('Selected dealer is inactive and cannot be linked to new loans');
          }
        }

        // Assigned agent
        let assignedAgentId = data.loan.assignedAgentId || null;
        if (!assignedAgentId) {
          const assignmentRes = await client.query(
            `SELECT agent_id FROM collection_assignments
             WHERE area_route = $1 AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
             LIMIT 1`,
            [data.customer.areaRoute.trim()]
          );
          if (assignmentRes.rows.length > 0) {
            assignedAgentId = assignmentRes.rows[0].agent_id;
          }
        }

        const resolvedFirstEmiDate = data.loan.firstEmiDate || (data.loan as any).emiStartDate;
        if (resolvedFirstEmiDate && data.loan.disbursementDate && resolvedFirstEmiDate < data.loan.disbursementDate) {
          throw new AppError('EMI Start Date cannot be earlier than loan disbursement date');
        }

        const calc = generateAmortizationSchedule({
          principalAmount: data.loan.principalAmount,
          downPayment: data.loan.downPayment || 0,
          annualInterestRate: data.loan.annualInterestRate,
          tenureMonths: data.loan.tenureMonths,
          installmentFrequency: data.loan.installmentFrequency,
          interestCalcMethod: data.loan.interestCalcMethod,
          disbursementDate: data.loan.disbursementDate,
          firstEmiDate: resolvedFirstEmiDate,
        });

        const loanId = uuidv4();
        const targetStatus = user.role === UserRole.DEALER ? LoanStatus.PENDING_APPROVAL : (data.loan.status || LoanStatus.ACTIVE);

        // Generate unique loan account number using max sequence to prevent unique constraint collisions
        const maxLoanRes = await client.query<{ max_num: number }>(
          `SELECT COALESCE(MAX(CAST(SUBSTRING(loan_account_no FROM '[0-9]+$') AS INTEGER)), 1000) as max_num
           FROM loans WHERE loan_account_no ~ '^LN-2026-[0-9]+$'`
        );
        const nextLoanNum = (Number(maxLoanRes.rows[0]?.max_num) || 1000) + 1;
        let loanAccountNo = `LN-2026-${nextLoanNum}`;
        const existsLoanCheck = await client.query('SELECT 1 FROM loans WHERE loan_account_no = $1', [loanAccountNo]);
        if (existsLoanCheck.rows.length > 0) {
          loanAccountNo = `LN-2026-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 90 + 10)}`;
        }

        const deviceBrand = data.loan.deviceBrand || (data as any).productBrand || null;
        const deviceModel = data.loan.deviceModel || (data as any).productModel || null;
        const deviceName = data.loan.deviceName || (deviceBrand && deviceModel ? `${deviceBrand} ${deviceModel}` : 'Smart Device');
        const imei1 = data.loan.imei1 || (data as any).imeiNumber || null;
        const imei2 = data.loan.imei2 || (data as any).serialNumber || null;
        const deviceStatus = data.loan.deviceStatus || 'ACTIVE';

        const insertLoanSql = `
          INSERT INTO loans (
            id, loan_account_no, customer_id, dealer_id,
            device_brand, device_model, device_name, imei1, imei2, device_status,
            principal_amount, down_payment, net_disbursed_amount,
            annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
            total_installments, emi_amount, total_interest, total_payable, total_paid,
            outstanding_balance, disbursement_date, first_emi_date, maturity_date,
            assigned_agent_id, status, created_by, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
            $21, 0.00, $22, $23, $24, $25, $26, $27, $28, NOW(), NOW()
          ) RETURNING *
        `;

        const loanRes = await client.query(insertLoanSql, [
          loanId,
          loanAccountNo,
          customerId,
          dealerId,
          deviceBrand,
          deviceModel,
          deviceName,
          imei1,
          imei2,
          deviceStatus,
          calc.principalAmount,
          calc.downPayment,
          calc.netDisbursedAmount,
          calc.annualInterestRate,
          calc.interestCalcMethod,
          calc.tenureMonths,
          calc.installmentFrequency,
          calc.totalInstallments,
          calc.emiAmount,
          calc.totalInterest,
          calc.totalPayable,
          calc.totalPayable,
          calc.disbursementDate,
          calc.firstEmiDate,
          calc.maturityDate,
          assignedAgentId,
          targetStatus,
          user.id,
        ]);

        createdLoan = loanRes.rows[0];

        if (targetStatus === LoanStatus.ACTIVE || targetStatus === LoanStatus.APPROVED) {
          const insertEmiSql = `
            INSERT INTO emi_installments (
              id, loan_id, customer_id, installment_number, due_date, principal_component,
              interest_component, expected_amount, paid_amount, remaining_amount, penalty_amount,
              status, days_overdue, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0.00, $9, 0.00, $10, 0, NOW(), NOW())
          `;

          for (const emi of calc.schedule) {
            await client.query(insertEmiSql, [
              uuidv4(),
              loanId,
              customerId,
              emi.installmentNumber,
              emi.dueDate,
              emi.principalComponent,
              emi.interestComponent,
              emi.expectedAmount,
              emi.remainingAmount,
              emi.status,
            ]);
          }
        }

        // If loan requires approval (e.g. Dealer origination), generate in-app notification for Super Admin & Admin
        if (targetStatus === LoanStatus.PENDING_APPROVAL) {
          let dealerName = 'Direct / Dealer';
          if (dealerId) {
            const dRes = await client.query('SELECT store_name FROM dealers WHERE id = $1', [dealerId]);
            if (dRes.rows.length > 0) {
              dealerName = dRes.rows[0].store_name;
            }
          }

          const adminUsers = await client.query(
            "SELECT id FROM users WHERE role IN ('SUPER_ADMIN', 'ADMIN') AND status = 'ACTIVE'"
          );

          const title = `New Dealer Loan Approval Request: ${loanAccountNo}`;
          const body = `Dealer "${dealerName}" has originated a new loan ${loanAccountNo} for customer ${createdCustomer.full_name} (${customerCode}). Financed Amount: ₹${calc.netDisbursedAmount}, EMI: ₹${calc.emiAmount}/mo, Device: ${deviceName}. Pending Super Admin review.`;

          for (const admin of adminUsers.rows) {
            await client.query(
              `INSERT INTO notifications (
                id, recipient_user_id, channel, type, title, body, status, scheduled_for, metadata, created_at
              ) VALUES ($1, $2, 'IN_APP', 'LOAN_APPROVAL_REQUEST', $3, $4, 'PENDING', NOW(), $5, NOW())`,
              [
                uuidv4(),
                admin.id,
                title,
                body,
                JSON.stringify({
                  loanId,
                  loanAccountNo,
                  customerId,
                  customerName: createdCustomer.full_name,
                  customerCode,
                  dealerId,
                  dealerName,
                  deviceName,
                  deviceBrand,
                  deviceModel,
                  netDisbursedAmount: calc.netDisbursedAmount,
                  emiAmount: calc.emiAmount,
                  tenureMonths: calc.tenureMonths,
                  kycStatus: 'PENDING',
                }),
              ]
            );
          }
        }
      }

      await AuditService.log({
        userId: user.id,
        action: 'CUSTOMER_ONBOARDED_ATOMIC',
        entity: 'Customer',
        entityId: customerId,
        newState: {
          customerCode,
          fullName: data.customer.fullName,
          hasLoan: Boolean(createdLoan),
          loanId: createdLoan?.id || null,
        },
      });

      return {
        customer: {
          id: createdCustomer.id,
          customerCode: createdCustomer.customer_code,
          fullName: createdCustomer.full_name,
          primaryPhone: createdCustomer.primary_phone,
          alternatePhone: createdCustomer.alternate_phone,
          addressLine1: createdCustomer.address_line1,
          addressLine2: createdCustomer.address_line2,
          landmark: createdCustomer.landmark,
          city: createdCustomer.city,
          state: createdCustomer.state,
          pincode: createdCustomer.pincode,
          areaRoute: createdCustomer.area_route,
          photoUrl: createdCustomer.photo_url,
          isActive: Boolean(createdCustomer.is_active),
          createdAt: createdCustomer.created_at,
          updatedAt: createdCustomer.updated_at,
        },
        loan: createdLoan ? {
          id: createdLoan.id,
          loanAccountNo: createdLoan.loan_account_no,
          customerId: createdLoan.customer_id,
          dealerId: createdLoan.dealer_id,
          principalAmount: Number(createdLoan.principal_amount),
          downPayment: Number(createdLoan.down_payment),
          netDisbursedAmount: Number(createdLoan.net_disbursed_amount),
          annualInterestRate: Number(createdLoan.annual_interest_rate),
          interestCalcMethod: createdLoan.interest_calc_method,
          tenureMonths: Number(createdLoan.tenure_months),
          installmentFrequency: createdLoan.installment_frequency,
          totalInstallments: Number(createdLoan.total_installments),
          emiAmount: Number(createdLoan.emi_amount),
          totalInterest: Number(createdLoan.total_interest),
          totalPayable: Number(createdLoan.total_payable),
          totalPaid: Number(createdLoan.total_paid),
          outstandingBalance: Number(createdLoan.outstanding_balance),
          status: createdLoan.status,
          disbursementDate: createdLoan.disbursement_date,
          firstEmiDate: createdLoan.first_emi_date,
          maturityDate: createdLoan.maturity_date,
          createdAt: createdLoan.created_at,
          updatedAt: createdLoan.updated_at,
        } : null,
      };
    });
  }

  /**
   * Update an existing customer profile.
   */
  public static async updateCustomer(
    id: string,
    data: UpdateCustomerDTO,
    user: AuthenticatedUser
  ) {
    const custRes = await queryPostgres('SELECT * FROM customers WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (custRes.rows.length === 0) {
      throw new NotFoundError('Customer not found');
    }
    const current = custRes.rows[0];

    const updates: string[] = [];
    const params: any[] = [id];
    let paramIndex = 2;

    if (data.fullName !== undefined) {
      updates.push(`full_name = $${paramIndex++}`);
      params.push(data.fullName.trim());
    }
    if (data.primaryPhone !== undefined) {
      updates.push(`primary_phone = $${paramIndex++}`);
      params.push(data.primaryPhone.trim());
    }
    if (data.alternatePhone !== undefined) {
      updates.push(`alternate_phone = $${paramIndex++}`);
      params.push(data.alternatePhone?.trim() || null);
    }
    if (data.addressLine1 !== undefined) {
      updates.push(`address_line1 = $${paramIndex++}`);
      params.push(data.addressLine1.trim());
    }
    if (data.addressLine2 !== undefined) {
      updates.push(`address_line2 = $${paramIndex++}`);
      params.push(data.addressLine2?.trim() || null);
    }
    if (data.landmark !== undefined) {
      updates.push(`landmark = $${paramIndex++}`);
      params.push(data.landmark?.trim() || null);
    }
    if (data.city !== undefined) {
      updates.push(`city = $${paramIndex++}`);
      params.push(data.city.trim());
    }
    if (data.state !== undefined) {
      updates.push(`state = $${paramIndex++}`);
      params.push(data.state.trim());
    }
    if (data.pincode !== undefined) {
      updates.push(`pincode = $${paramIndex++}`);
      params.push(data.pincode.trim());
    }
    if (data.areaRoute !== undefined) {
      updates.push(`area_route = $${paramIndex++}`);
      params.push(data.areaRoute.trim());
    }
    if (data.photoUrl !== undefined) {
      updates.push(`photo_url = $${paramIndex++}`);
      params.push(data.photoUrl || null);
    }
    if (data.isActive !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      params.push(data.isActive);
    }

    if (updates.length === 0) {
      return current;
    }

    updates.push(`updated_at = NOW()`);

    const sql = `
      UPDATE customers
      SET ${updates.join(', ')}
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
    `;

    const result = await queryPostgres(sql, params);
    const updated = result.rows[0];

    await AuditService.log({
      userId: user.id,
      action: 'CUSTOMER_UPDATED',
      entity: 'Customer',
      entityId: id,
      previousState: current,
      newState: data as any,
    });

    return {
      id: updated.id,
      customerCode: updated.customer_code,
      fullName: updated.full_name,
      primaryPhone: updated.primary_phone,
      alternatePhone: updated.alternate_phone,
      addressLine1: updated.address_line1,
      city: updated.city,
      state: updated.state,
      pincode: updated.pincode,
      areaRoute: updated.area_route,
      isActive: Boolean(updated.is_active),
      updatedAt: updated.updated_at,
    };
  }

  /**
   * Soft-delete a customer (Admin only).
   */
  public static async deleteCustomer(id: string, user: AuthenticatedUser) {
    const custRes = await queryPostgres('SELECT id FROM customers WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (custRes.rows.length === 0) {
      throw new NotFoundError('Customer not found');
    }

    await queryPostgres(
      'UPDATE customers SET deleted_at = NOW(), is_active = FALSE WHERE id = $1',
      [id]
    );

    await AuditService.log({
      userId: user.id,
      action: 'CUSTOMER_DELETED',
      entity: 'Customer',
      entityId: id,
    });
  }
}
