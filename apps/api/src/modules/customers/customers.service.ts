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
           AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`,
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
    }
    loansSql += ' ORDER BY l.created_at DESC';

    const loansRes = await queryPostgres(loansSql, loansParams);

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
      loans: loansRes.rows.map((l: any) => ({
        id: l.id,
        loanAccountNo: l.loan_account_no,
        dealerId: l.dealer_id,
        dealerStoreName: l.dealer_store_name,
        dealerCode: l.dealer_code,
        principalAmount: Number(l.principal_amount),
        emiAmount: Number(l.emi_amount),
        totalPayable: Number(l.total_payable),
        totalPaid: Number(l.total_paid),
        outstandingBalance: Number(l.outstanding_balance),
        status: l.status,
        disbursementDate: l.disbursement_date,
        maturityDate: l.maturity_date,
      })),
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
    const countRes = await queryPostgres<{ count: string }>('SELECT COUNT(*) as count FROM customers');
    const totalCount = parseInt(countRes.rows[0]?.count || '0', 10);
    const customerCode = `CUST-2026-${(1000 + totalCount + 1).toString()}`;

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
      const countRes = await client.query<{ count: string }>('SELECT COUNT(*) as count FROM customers');
      const totalCount = parseInt(countRes.rows[0]?.count || '0', 10);
      const customerCode = `CUST-2026-${(1000 + totalCount + 1).toString()}`;

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
        const targetStatus = data.loan.status || LoanStatus.ACTIVE;

        const countLoanRes = await client.query<{ count: string }>('SELECT COUNT(*) as count FROM loans');
        const totalLoanCount = parseInt(countLoanRes.rows[0]?.count || '0', 10);
        const loanAccountNo = `LN-2026-${(1000 + totalLoanCount + 1).toString()}`;

        const insertLoanSql = `
          INSERT INTO loans (
            id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount,
            annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
            total_installments, emi_amount, total_interest, total_payable, total_paid,
            outstanding_balance, disbursement_date, first_emi_date, maturity_date,
            assigned_agent_id, status, created_by, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, 0.00, $16, $17, $18, $19,
            $20, $21, $22, NOW(), NOW()
          ) RETURNING *
        `;

        const loanRes = await client.query(insertLoanSql, [
          loanId,
          loanAccountNo,
          customerId,
          dealerId,
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
