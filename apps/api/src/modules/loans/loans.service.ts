import { v4 as uuidv4 } from 'uuid';
import { queryPostgres, runPostgresTransaction } from '../../database/postgres';
import { db } from '../../database/db';
import {
  generateAmortizationSchedule,
  computeEmiStatus,
  getBusinessDate,
  LoanCalculationInput,
  LoanStatus,
  UserRole,
  UserStatus,
  InterestMethod,
  RepaymentFrequency,
  EMIStatus,
} from '@crm/shared';
import { AppError, NotFoundError, ForbiddenError } from '../../middlewares/error.middleware';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { AuditService } from '../audit/audit.service';

export interface CreateLoanDTO {
  customerId: string;
  principalAmount: number;
  downPayment?: number;
  annualInterestRate: number;
  interestCalcMethod: InterestMethod;
  tenureMonths: number;
  installmentFrequency: RepaymentFrequency;
  disbursementDate: string;
  firstEmiDate?: string;
  emiStartDate?: string;
  assignedAgentId?: string | null;
  dealerId?: string | null;
  status?: LoanStatus;
}

export class LoanService {
  /**
   * Preview loan amortization calculation without persisting.
   */
  public static calculatePreview(input: LoanCalculationInput) {
    return generateAmortizationSchedule(input);
  }

  /**
   * Create and book a new loan with atomic EMI installment generation in PostgreSQL.
   */
  public static async createLoan(data: CreateLoanDTO, user: AuthenticatedUser) {
    // 1. Verify customer exists in PostgreSQL
    const custRes = await queryPostgres(
      'SELECT id, customer_code, full_name, area_route FROM customers WHERE id = $1 AND deleted_at IS NULL',
      [data.customerId]
    );

    if (custRes.rows.length === 0) {
      throw new NotFoundError('Customer not found');
    }

    const customer = custRes.rows[0];

    // 2. Validate dealer (RLAC: never trust dealerId supplied by frontend for DEALER role)
    let dealerId: string | null = data.dealerId || null;
    if (user.role === UserRole.DEALER) {
      if (!user.dealerId) {
        throw new ForbiddenError('Dealer context missing');
      }
      dealerId = user.dealerId;
    }

    let dealerInfo: { store_name: string; dealer_code: string } | null = null;
    if (dealerId) {
      const dealerCheck = await queryPostgres(
        'SELECT id, store_name, dealer_code, status FROM dealers WHERE id = $1',
        [dealerId]
      );
      if (dealerCheck.rows.length === 0) {
        throw new NotFoundError('Selected dealer not found');
      }
      if (dealerCheck.rows[0].status !== 'ACTIVE') {
        throw new AppError('Selected dealer is inactive and cannot be linked to new loans');
      }
      dealerInfo = {
        store_name: dealerCheck.rows[0].store_name,
        dealer_code: dealerCheck.rows[0].dealer_code,
      };
    }

    // 3. Resolve assigned agent
    let assignedAgentId = data.assignedAgentId || null;
    if (assignedAgentId) {
      const agentCheck = await queryPostgres(
        'SELECT id, role FROM users WHERE id = $1 AND deleted_at IS NULL AND status = $2',
        [assignedAgentId, 'ACTIVE']
      );
      if (agentCheck.rows.length === 0) {
        throw new AppError('Assigned collection agent not found or is inactive');
      }
    } else {
      // Look up active assignment for this customer or area route
      const assignmentRes = await queryPostgres(
        `SELECT agent_id FROM collection_assignments
         WHERE (customer_id = $1 OR area_route = $2)
           AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
         ORDER BY customer_id NULLS LAST LIMIT 1`,
        [customer.id, customer.area_route]
      );
      if (assignmentRes.rows.length > 0) {
        assignedAgentId = assignmentRes.rows[0].agent_id;
      }
    }

    const resolvedFirstEmiDate = data.firstEmiDate || data.emiStartDate;
    if (resolvedFirstEmiDate && data.disbursementDate && resolvedFirstEmiDate < data.disbursementDate) {
      throw new AppError('EMI Start Date cannot be earlier than loan disbursement date');
    }

    // 4. Calculate deterministic amortization schedule (Banker's rounding & last-cent conservation)
    const calc = generateAmortizationSchedule({
      principalAmount: data.principalAmount,
      downPayment: data.downPayment || 0,
      annualInterestRate: data.annualInterestRate,
      tenureMonths: data.tenureMonths,
      installmentFrequency: data.installmentFrequency,
      interestCalcMethod: data.interestCalcMethod,
      disbursementDate: data.disbursementDate,
      firstEmiDate: resolvedFirstEmiDate,
    });

    const loanId = uuidv4();
    // Rule: Dealer-originated loans MUST require Super Admin approval and cannot start ACTIVE or APPROVED
    const targetStatus = user.role === UserRole.DEALER ? LoanStatus.PENDING_APPROVAL : (data.status || LoanStatus.ACTIVE);

    // 5. Generate unique loan account number
    const countRes = await queryPostgres<{ count: string }>('SELECT COUNT(*) as count FROM loans');
    const totalCount = parseInt(countRes.rows[0]?.count || '0', 10);
    const loanAccountNo = `LN-2026-${(1000 + totalCount + 1).toString()}`;
    const now = new Date().toISOString();

    // 6. Execute atomic PostgreSQL transaction
    await runPostgresTransaction(async (client) => {
      // Insert Loan record
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
        )
      `;

      await client.query(insertLoanSql, [
        loanId,
        loanAccountNo,
        customer.id,
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
        calc.totalPayable, // initial outstanding equals total payable
        calc.disbursementDate,
        calc.firstEmiDate,
        calc.maturityDate,
        assignedAgentId,
        targetStatus,
        user.id,
      ]);

      // If active or approved, generate all EMI Installments atomically
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
            customer.id,
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
    });

    // 6. Dual-write to SQLite for transitional backward compatibility
    try {
      let sqliteUserId = user.id;
      const userCheck = db.prepare('SELECT id FROM users WHERE id = ?').get(user.id);
      if (!userCheck) {
        const fallbackUser = db.prepare("SELECT id FROM users WHERE role IN ('SUPER_ADMIN', 'ADMIN') LIMIT 1").get() as { id: string } | undefined
          || (db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string } | undefined);
        if (fallbackUser) sqliteUserId = fallbackUser.id;
      }

      let sqliteAssignedAgentId = assignedAgentId;
      if (sqliteAssignedAgentId) {
        const agentCheck = db.prepare('SELECT id FROM users WHERE id = ?').get(sqliteAssignedAgentId);
        if (!agentCheck) sqliteAssignedAgentId = null;
      }

      // Ensure customer exists in SQLite
      const custCheck = db.prepare('SELECT id FROM customers WHERE id = ?').get(customer.id);
      if (!custCheck) {
        db.prepare(`
          INSERT INTO customers (
            id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, is_active, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'Default Address', 'Bengaluru', 'Karnataka', '560001', ?, 1, ?, ?, ?)
        `).run(customer.id, customer.customer_code, customer.full_name, '9876543210', customer.area_route, sqliteUserId, now, now);
      }

      db.prepare(`
        INSERT INTO loans (
          id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount,
          annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
          total_installments, emi_amount, total_interest, total_payable, total_paid,
          outstanding_balance, disbursement_date, first_emi_date, maturity_date,
          assigned_agent_id, status, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        loanId, loanAccountNo, customer.id, dealerId, calc.principalAmount, calc.downPayment, calc.netDisbursedAmount,
        calc.annualInterestRate, calc.interestCalcMethod, calc.tenureMonths, calc.installmentFrequency,
        calc.totalInstallments, calc.emiAmount, calc.totalInterest, calc.totalPayable, calc.totalPayable,
        calc.disbursementDate, calc.firstEmiDate, calc.maturityDate, sqliteAssignedAgentId,
        targetStatus, sqliteUserId, now, now
      );

      if (targetStatus === LoanStatus.ACTIVE || targetStatus === LoanStatus.APPROVED) {
        const insertEmiStmt = db.prepare(`
          INSERT INTO emi_installments (
            id, loan_id, customer_id, installment_number, due_date, principal_component,
            interest_component, expected_amount, paid_amount, remaining_amount, penalty_amount,
            status, days_overdue, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.0, ?, 0.0, ?, 0, ?, ?)
        `);

        for (const emi of calc.schedule) {
          insertEmiStmt.run(
            uuidv4(), loanId, customer.id, emi.installmentNumber, emi.dueDate,
            emi.principalComponent, emi.interestComponent, emi.expectedAmount,
            emi.remainingAmount, emi.status, now, now
          );
        }
      }
    } catch {
      // Safe fallback
    }

    // 7. Audit log
    await AuditService.log({
      userId: user.id,
      action: 'LOAN_ORIGINATED',
      entity: 'Loan',
      entityId: loanId,
      newState: {
        loanAccountNo,
        customerId: customer.id,
        dealerId,
        principalAmount: calc.principalAmount,
        totalPayable: calc.totalPayable,
        totalInstallments: calc.totalInstallments,
        status: targetStatus,
      },
    });

    return {
      id: loanId,
      loanAccountNo,
      customerId: customer.id,
      customerName: customer.full_name,
      dealerId,
      dealerStoreName: dealerInfo?.store_name || null,
      dealerCode: dealerInfo?.dealer_code || null,
      principalAmount: calc.principalAmount,
      downPayment: calc.downPayment,
      netDisbursedAmount: calc.netDisbursedAmount,
      annualInterestRate: calc.annualInterestRate,
      interestCalcMethod: calc.interestCalcMethod,
      tenureMonths: calc.tenureMonths,
      installmentFrequency: calc.installmentFrequency,
      totalInstallments: calc.totalInstallments,
      emiAmount: calc.emiAmount,
      totalInterest: calc.totalInterest,
      totalPayable: calc.totalPayable,
      outstandingBalance: calc.totalPayable,
      totalPaid: 0,
      disbursementDate: calc.disbursementDate,
      firstEmiDate: calc.firstEmiDate,
      maturityDate: calc.maturityDate,
      assignedAgentId,
      status: targetStatus,
      createdAt: now,
      installments: calc.schedule,
    };
  }

  /**
   * Approve a pending loan application.
   */
  public static async approveLoan(id: string, user: AuthenticatedUser, data?: { notes?: string }) {
    if (user.role === UserRole.DEALER) {
      throw new ForbiddenError('Dealers cannot approve loans. Super Admin approval is required.');
    }

    const loanRes = await queryPostgres('SELECT * FROM loans WHERE id = $1', [id]);
    if (loanRes.rows.length === 0) {
      throw new NotFoundError('Loan not found');
    }

    const loan = loanRes.rows[0];
    if (loan.status !== LoanStatus.PENDING_APPROVAL && loan.status !== LoanStatus.DRAFT) {
      throw new AppError(`Cannot approve loan with current status '${loan.status}'`);
    }

    await runPostgresTransaction(async (client) => {
      await client.query(
        'UPDATE loans SET status = $1, approval_notes = $2, updated_at = NOW() WHERE id = $3',
        [LoanStatus.APPROVED, data?.notes || null, id]
      );

      // Check if installments already exist; if not, generate them atomically upon approval
      const emiCheck = await client.query('SELECT COUNT(*) as count FROM emi_installments WHERE loan_id = $1', [id]);
      const existingCount = parseInt(emiCheck.rows[0]?.count || '0', 10);
      if (existingCount === 0) {
        const calc = generateAmortizationSchedule({
          principalAmount: Number(loan.principal_amount),
          downPayment: Number(loan.down_payment),
          annualInterestRate: Number(loan.annual_interest_rate),
          tenureMonths: Number(loan.tenure_months),
          installmentFrequency: loan.installment_frequency as RepaymentFrequency,
          interestCalcMethod: loan.interest_calc_method as InterestMethod,
          disbursementDate: loan.disbursement_date,
          firstEmiDate: loan.first_emi_date,
        });

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
            id,
            loan.customer_id,
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
    });

    // Sync to SQLite
    try {
      db.prepare('UPDATE loans SET status = ?, updated_at = ? WHERE id = ?').run(
        LoanStatus.APPROVED, new Date().toISOString(), id
      );
    } catch {}

    await AuditService.log({
      userId: user.id,
      action: 'LOAN_APPROVED',
      entity: 'Loan',
      entityId: id,
      previousState: { status: loan.status },
      newState: { status: LoanStatus.APPROVED, notes: data?.notes },
    });

    return {
      id,
      loanAccountNo: loan.loan_account_no,
      status: LoanStatus.APPROVED,
      notes: data?.notes,
    };
  }

  /**
   * Reject a pending loan application.
   */
  public static async rejectLoan(id: string, user: AuthenticatedUser, data: { reason: string }) {
    if (user.role === UserRole.DEALER) {
      throw new ForbiddenError('Dealers cannot reject loans. Super Admin approval is required.');
    }

    const loanRes = await queryPostgres('SELECT * FROM loans WHERE id = $1', [id]);
    if (loanRes.rows.length === 0) {
      throw new NotFoundError('Loan not found');
    }

    const loan = loanRes.rows[0];
    if (loan.status !== LoanStatus.PENDING_APPROVAL && loan.status !== LoanStatus.DRAFT) {
      throw new AppError(`Cannot reject loan with current status '${loan.status}'`);
    }

    await queryPostgres(
      'UPDATE loans SET status = $1, rejection_reason = $2, updated_at = NOW() WHERE id = $3',
      [LoanStatus.REJECTED, data.reason, id]
    );

    // Sync to SQLite
    try {
      db.prepare('UPDATE loans SET status = ?, updated_at = ? WHERE id = ?').run(
        LoanStatus.REJECTED, new Date().toISOString(), id
      );
    } catch {}

    await AuditService.log({
      userId: user.id,
      action: 'LOAN_REJECTED',
      entity: 'Loan',
      entityId: id,
      previousState: { status: loan.status },
      newState: { status: LoanStatus.REJECTED, reason: data.reason },
    });

    return {
      id,
      loanAccountNo: loan.loan_account_no,
      status: LoanStatus.REJECTED,
      reason: data.reason,
    };
  }

  /**
   * Fetch all dealer-originated loans pending Super Admin approval.
   */
  public static async getPendingApprovals(user: AuthenticatedUser) {
    if (user.role === UserRole.DEALER || user.role === UserRole.COLLECTION_AGENT) {
      throw new ForbiddenError('Only administrators can access the loan approval queue');
    }

    const sql = `
      SELECT
        l.id,
        l.loan_account_no,
        l.customer_id,
        c.full_name AS customer_name,
        c.customer_code,
        c.primary_phone AS customer_phone,
        l.dealer_id,
        d.store_name AS dealer_store_name,
        d.dealer_code,
        d.owner_name AS dealer_contact,
        d.phone AS dealer_phone,
        l.principal_amount,
        l.down_payment,
        l.net_disbursed_amount,
        l.annual_interest_rate,
        l.interest_calc_method,
        l.tenure_months,
        l.installment_frequency,
        l.emi_amount,
        l.total_interest,
        l.total_payable,
        l.disbursement_date,
        l.first_emi_date,
        l.status,
        l.created_at,
        u.full_name AS submitted_by_name,
        u.role AS submitted_by_role,
        (
          SELECT COUNT(*)
          FROM kyc_documents kd
          WHERE kd.customer_id = l.customer_id
        ) AS kyc_doc_count,
        (
          SELECT status
          FROM kyc_documents kd
          WHERE kd.customer_id = l.customer_id
          ORDER BY kd.created_at DESC
          LIMIT 1
        ) AS latest_kyc_status
      FROM loans l
      JOIN customers c ON l.customer_id = c.id
      LEFT JOIN dealers d ON l.dealer_id = d.id
      LEFT JOIN users u ON l.created_by = u.id
      WHERE l.status = 'PENDING_APPROVAL'
      ORDER BY l.created_at DESC
    `;

    const res = await queryPostgres(sql);
    return res.rows.map((row: any) => ({
      id: row.id,
      loanAccountNo: row.loan_account_no,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerCode: row.customer_code,
      customerPhone: row.customer_phone,
      dealerId: row.dealer_id,
      dealerStoreName: row.dealer_store_name || 'Direct / Head Office',
      dealerCode: row.dealer_code,
      dealerContact: row.dealer_contact,
      dealerPhone: row.dealer_phone,
      principalAmount: Number(row.principal_amount),
      downPayment: Number(row.down_payment),
      netDisbursedAmount: Number(row.net_disbursed_amount),
      annualInterestRate: Number(row.annual_interest_rate),
      monthlyInterestRate: Number(row.annual_interest_rate),
      tenureMonths: Number(row.tenure_months),
      installmentFrequency: row.installment_frequency,
      emiAmount: Number(row.emi_amount),
      totalInterest: Number(row.total_interest),
      totalPayable: Number(row.total_payable),
      disbursementDate: row.disbursement_date,
      firstEmiDate: row.first_emi_date,
      status: row.status,
      createdAt: row.created_at,
      submittedByName: row.submitted_by_name,
      submittedByRole: row.submitted_by_role,
      kycStatus: row.latest_kyc_status || (Number(row.kyc_doc_count) > 0 ? 'SUBMITTED' : 'PENDING'),
    }));
  }

  /**
   * Disburse an approved loan and activate its repayment schedule.
   */
  public static async disburseLoan(
    id: string,
    user: AuthenticatedUser,
    data?: { disbursementDate?: string; firstEmiDate?: string; assignedAgentId?: string | null }
  ) {
    const loanRes = await queryPostgres('SELECT * FROM loans WHERE id = $1', [id]);
    if (loanRes.rows.length === 0) {
      throw new NotFoundError('Loan not found');
    }

    const loan = loanRes.rows[0];
    if (loan.status === LoanStatus.PENDING_APPROVAL) {
      throw new AppError('Dealer-originated loan is pending Super Admin approval and cannot be disbursed yet. Please approve the loan first.');
    }
    if (loan.status !== LoanStatus.APPROVED && loan.status !== LoanStatus.ACTIVE) {
      throw new AppError(`Cannot disburse loan with current status '${loan.status}'`);
    }

    const disbursementDate = data?.disbursementDate || loan.disbursement_date;
    const firstEmiDate = data?.firstEmiDate || (data as any)?.emiStartDate || loan.first_emi_date;
    if (firstEmiDate && disbursementDate && firstEmiDate < disbursementDate) {
      throw new AppError('EMI Start Date cannot be earlier than loan disbursement date');
    }
    const assignedAgentId = data?.assignedAgentId !== undefined ? data.assignedAgentId : loan.assigned_agent_id;

    const calc = generateAmortizationSchedule({
      principalAmount: Number(loan.principal_amount),
      downPayment: Number(loan.down_payment),
      annualInterestRate: Number(loan.annual_interest_rate),
      tenureMonths: Number(loan.tenure_months),
      installmentFrequency: loan.installment_frequency as RepaymentFrequency,
      interestCalcMethod: loan.interest_calc_method as InterestMethod,
      disbursementDate,
      firstEmiDate,
    });

    await runPostgresTransaction(async (client) => {
      // Update loan status to ACTIVE
      await client.query(
        `UPDATE loans
         SET status = $1, disbursement_date = $2, first_emi_date = $3, maturity_date = $4,
             assigned_agent_id = $5, updated_at = NOW()
         WHERE id = $6`,
        [LoanStatus.ACTIVE, calc.disbursementDate, calc.firstEmiDate, calc.maturityDate, assignedAgentId, id]
      );

      // Check if installments already exist
      const emiCheck = await client.query('SELECT COUNT(*) as count FROM emi_installments WHERE loan_id = $1', [id]);
      const existingCount = parseInt(emiCheck.rows[0]?.count || '0', 10);

      if (existingCount === 0) {
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
            id,
            loan.customer_id,
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
    });

    await AuditService.log({
      userId: user.id,
      action: 'LOAN_DISBURSED',
      entity: 'Loan',
      entityId: id,
      previousState: { status: loan.status },
      newState: {
        status: LoanStatus.ACTIVE,
        disbursementDate: calc.disbursementDate,
        maturityDate: calc.maturityDate,
      },
    });

    return {
      id,
      loanAccountNo: loan.loan_account_no,
      status: LoanStatus.ACTIVE,
      disbursementDate: calc.disbursementDate,
      maturityDate: calc.maturityDate,
    };
  }

  /**
   * List loans with multi-field search, pagination, and strict agent portfolio scoping.
   */
  public static async listLoans(
    user: AuthenticatedUser,
    query: {
      page?: number;
      limit?: number;
      status?: string;
      search?: string;
      customerId?: string;
      agentId?: string;
      dealerId?: string;
    }
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const offset = (page - 1) * limit;

    let sql = `
      SELECT l.*,
             c.full_name as customer_name,
             c.customer_code,
             c.primary_phone,
             c.area_route,
             u.full_name as assigned_agent_name,
             u.phone as assigned_agent_phone,
             d.store_name as dealer_store_name,
             d.dealer_code
      FROM loans l
      JOIN customers c ON l.customer_id = c.id
      LEFT JOIN users u ON l.assigned_agent_id = u.id
      LEFT JOIN dealers d ON l.dealer_id = d.id
      WHERE c.deleted_at IS NULL
    `;
    const params: any[] = [];
    let paramIndex = 1;

    // Dealer Row-Level Scoping: Dealer only sees loans originated from their store
    if (user.role === UserRole.DEALER) {
      if (!user.dealerId) {
        throw new ForbiddenError('Dealer context missing');
      }
      sql += ` AND l.dealer_id = $${paramIndex++}`;
      params.push(user.dealerId);
    } else if (user.role === UserRole.COLLECTION_AGENT) {
      // Agent Row-Level Scoping: Agent only sees loans assigned directly to them
      sql += ` AND l.assigned_agent_id = $${paramIndex++}`;
      params.push(user.id);
    } else {
      if (query.agentId) {
        sql += ` AND l.assigned_agent_id = $${paramIndex++}`;
        params.push(query.agentId);
      }
      if (query.dealerId) {
        sql += ` AND l.dealer_id = $${paramIndex++}`;
        params.push(query.dealerId);
      }
    }

    if (query.status) {
      sql += ` AND l.status = $${paramIndex++}`;
      params.push(query.status);
    }

    if (query.search) {
      sql += ` AND (
        l.loan_account_no ILIKE $${paramIndex}
        OR c.full_name ILIKE $${paramIndex}
        OR c.primary_phone ILIKE $${paramIndex}
        OR c.customer_code ILIKE $${paramIndex}
        OR d.store_name ILIKE $${paramIndex}
        OR d.dealer_code ILIKE $${paramIndex}
      )`;
      params.push(`%${query.search}%`);
      paramIndex++;
    }

    // Get count
    const countSql = `SELECT COUNT(*) as total FROM (${sql}) sub`;
    const countRes = await queryPostgres<{ total: string }>(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    sql += ` ORDER BY l.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await queryPostgres(sql, params);

    const loans = result.rows.map((l: any) => ({
      id: l.id,
      loanAccountNo: l.loan_account_no,
      customerId: l.customer_id,
      customerName: l.customer_name,
      customerCode: l.customer_code,
      primaryPhone: l.primary_phone,
      areaRoute: l.area_route,
      dealerId: l.dealer_id,
      dealerStoreName: l.dealer_store_name,
      dealerCode: l.dealer_code,
      principalAmount: Number(l.principal_amount),
      downPayment: Number(l.down_payment),
      netDisbursedAmount: Number(l.net_disbursed_amount),
      annualInterestRate: Number(l.annual_interest_rate),
      interestCalcMethod: l.interest_calc_method,
      tenureMonths: Number(l.tenure_months),
      installmentFrequency: l.installment_frequency,
      totalInstallments: Number(l.total_installments),
      emiAmount: Number(l.emi_amount),
      totalInterest: Number(l.total_interest),
      totalPayable: Number(l.total_payable),
      totalPaid: Number(l.total_paid),
      outstandingBalance: Number(l.outstanding_balance),
      disbursementDate: l.disbursement_date,
      firstEmiDate: l.first_emi_date,
      maturityDate: l.maturity_date,
      assignedAgentId: l.assigned_agent_id,
      assignedAgentName: l.assigned_agent_name,
      assignedAgentPhone: l.assigned_agent_phone,
      status: l.status,
      createdAt: l.created_at,
      updatedAt: l.updated_at,
    }));

    return {
      loans,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Retrieve loan by ID with complete EMI schedule and strict Row-Level Access Control (RLAC).
   */
  public static async getLoanById(id: string, user: AuthenticatedUser) {
    const loanSql = `
      SELECT l.*,
             c.full_name as customer_name,
             c.customer_code,
             c.primary_phone,
             c.address_line1,
             c.area_route,
             u.full_name as assigned_agent_name,
             u.phone as assigned_agent_phone,
             (SELECT TO_CHAR(ca.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM collection_assignments ca WHERE ca.loan_id = l.id AND ca.is_active = TRUE LIMIT 1) as assigned_at,
             d.store_name as dealer_store_name,
             d.dealer_code
      FROM loans l
      JOIN customers c ON l.customer_id = c.id
      LEFT JOIN users u ON l.assigned_agent_id = u.id
      LEFT JOIN dealers d ON l.dealer_id = d.id
      WHERE l.id = $1 AND c.deleted_at IS NULL
    `;

    const loanRes = await queryPostgres(loanSql, [id]);
    if (loanRes.rows.length === 0) {
      throw new NotFoundError('Loan not found');
    }

    const loan = loanRes.rows[0];

    // Server-side RLAC: Check dealer scoping and collection agent assignment permission (IDOR protection)
    if (user.role === UserRole.DEALER) {
      if (!user.dealerId || loan.dealer_id !== user.dealerId) {
        throw new ForbiddenError('You do not have access to this loan account');
      }
    } else if (user.role === UserRole.COLLECTION_AGENT) {
      if (!loan.assigned_agent_id || loan.assigned_agent_id !== user.id) {
        throw new ForbiddenError('You do not have access to this loan account');
      }
    }

    // Fetch all EMI installments for this loan
    const emiRes = await queryPostgres(
      `SELECT * FROM emi_installments
       WHERE loan_id = $1
       ORDER BY installment_number ASC`,
      [id]
    );

    const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');
    const installments = emiRes.rows.map((e: any) => {
      const evalResult = computeEmiStatus({
        dueDate: getBusinessDate(e.due_date, 'Asia/Kolkata'),
        expectedAmount: Number(e.expected_amount),
        paidAmount: Number(e.paid_amount),
        remainingAmount: Number(e.remaining_amount),
        penaltyAmount: Number(e.penalty_amount || 0),
        businessToday,
      });

      return {
        id: e.id,
        installmentNumber: Number(e.installment_number),
        dueDate: e.due_date,
        principalComponent: Number(e.principal_component),
        interestComponent: Number(e.interest_component),
        expectedAmount: Number(e.expected_amount),
        paidAmount: Number(e.paid_amount),
        remainingAmount: Number(e.remaining_amount),
        penaltyAmount: Number(e.penalty_amount || 0),
        status: evalResult.status,
        daysOverdue: evalResult.daysOverdue,
        lastPaymentDate: e.last_payment_date,
      };
    });

    return {
      id: loan.id,
      loanAccountNo: loan.loan_account_no,
      customerId: loan.customer_id,
      customerName: loan.customer_name,
      customerCode: loan.customer_code,
      primaryPhone: loan.primary_phone,
      addressLine1: loan.address_line1,
      areaRoute: loan.area_route,
      dealerId: loan.dealer_id,
      dealerStoreName: loan.dealer_store_name,
      dealerCode: loan.dealer_code,
      principalAmount: Number(loan.principal_amount),
      downPayment: Number(loan.down_payment),
      netDisbursedAmount: Number(loan.net_disbursed_amount),
      annualInterestRate: Number(loan.annual_interest_rate),
      interestCalcMethod: loan.interest_calc_method,
      tenureMonths: Number(loan.tenure_months),
      installmentFrequency: loan.installment_frequency,
      totalInstallments: Number(loan.total_installments),
      emiAmount: Number(loan.emi_amount),
      totalInterest: Number(loan.total_interest),
      totalPayable: Number(loan.total_payable),
      totalPaid: Number(loan.total_paid),
      outstandingBalance: Number(loan.outstanding_balance),
      disbursementDate: loan.disbursement_date,
      firstEmiDate: loan.first_emi_date,
      maturityDate: loan.maturity_date,
      assignedAgentId: loan.assigned_agent_id,
      assignedAgentName: loan.assigned_agent_name,
      assignedAgentPhone: loan.assigned_agent_phone,
      assignedAt: loan.assigned_at,
      status: loan.status,
      createdAt: loan.created_at,
      updatedAt: loan.updated_at,
      installments,
    };
  }

  /**
   * Assign a loan recovery case to a specific active Collection Agent.
   * Atomic PostgreSQL transaction with row-level lock and audit logging.
   */
  public static async assignAgent(
    loanId: string,
    agentId: string,
    user: AuthenticatedUser,
    notes?: string
  ) {
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.ADMIN &&
      user.role !== UserRole.BRANCH_MANAGER
    ) {
      throw new ForbiddenError('Only administrators and branch managers can assign collection recovery cases');
    }

    // Verify agent is an ACTIVE collection agent
    const agentRes = await queryPostgres(
      'SELECT id, full_name, role, status, phone FROM users WHERE id = $1 AND deleted_at IS NULL',
      [agentId]
    );

    if (agentRes.rows.length === 0) {
      throw new NotFoundError('Collection agent not found');
    }

    const agent = agentRes.rows[0];
    if (agent.role !== UserRole.COLLECTION_AGENT) {
      throw new AppError('Assigned user must have COLLECTION_AGENT role', 400);
    }
    if (agent.status !== UserStatus.ACTIVE) {
      throw new AppError('Cannot assign case to an inactive collection agent', 400);
    }

    return await runPostgresTransaction(async (client) => {
      // Row-level lock to prevent concurrent inconsistent assignments
      const loanRes = await client.query(
        `SELECT id, loan_account_no, customer_id, assigned_agent_id, status
         FROM loans
         WHERE id = $1 FOR UPDATE`,
        [loanId]
      );

      if (loanRes.rows.length === 0) {
        throw new NotFoundError('Loan account not found');
      }

      const loan = loanRes.rows[0];
      const previousAgentId = loan.assigned_agent_id;
      let previousAgentName: string | null = null;
      if (previousAgentId) {
        const prevAgentRes = await client.query('SELECT full_name FROM users WHERE id = $1', [previousAgentId]);
        previousAgentName = prevAgentRes.rows[0]?.full_name || null;
      }
      const isReassignment = Boolean(previousAgentId && previousAgentId !== agentId);

      // Deactivate any existing active assignment for this loan
      await client.query(
        `UPDATE collection_assignments
         SET is_active = FALSE, effective_to = CURRENT_DATE
         WHERE loan_id = $1 AND is_active = TRUE`,
        [loanId]
      );

      // Insert new active assignment
      const assignmentId = uuidv4();
      await client.query(
        `INSERT INTO collection_assignments (
          id, loan_id, customer_id, agent_id, assigned_by, effective_from, is_active, created_at
        ) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, TRUE, NOW())`,
        [assignmentId, loanId, loan.customer_id, agentId, user.id]
      );

      // Update loans table
      await client.query(
        'UPDATE loans SET assigned_agent_id = $1, updated_at = NOW() WHERE id = $2',
        [agentId, loanId]
      );

      // Log immutable audit entry
      await AuditService.log({
        userId: user.id,
        action: isReassignment ? 'LOAN_RECOVERY_REASSIGNED' : 'LOAN_RECOVERY_ASSIGNED',
        entity: 'Loan',
        entityId: loanId,
        previousState: {
          loanId,
          loanAccountNo: loan.loan_account_no,
          assignedAgentId: previousAgentId || null,
          assignedAgentName: previousAgentName || null,
        },
        newState: {
          loanId,
          loanAccountNo: loan.loan_account_no,
          assignedAgentId: agentId,
          assignedAgentName: agent.full_name,
          assignedAgentPhone: agent.phone,
          assignedBy: user.id,
          assignmentId,
          notes: notes || null,
        },
      });

      return {
        loanId,
        loanAccountNo: loan.loan_account_no,
        assignedAgentId: agentId,
        assignedAgentName: agent.full_name,
        assignedAgentPhone: agent.phone,
        assignmentId,
        isReassignment,
        assignedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * Unassign a loan recovery case from its current agent.
   * Atomic PostgreSQL transaction with row-level lock and audit logging.
   */
  public static async unassignAgent(
    loanId: string,
    user: AuthenticatedUser,
    reason?: string
  ) {
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.ADMIN &&
      user.role !== UserRole.BRANCH_MANAGER
    ) {
      throw new ForbiddenError('Only administrators and branch managers can unassign collection recovery cases');
    }

    return await runPostgresTransaction(async (client) => {
      const loanRes = await client.query(
        `SELECT id, loan_account_no, customer_id, assigned_agent_id
         FROM loans
         WHERE id = $1 FOR UPDATE`,
        [loanId]
      );

      if (loanRes.rows.length === 0) {
        throw new NotFoundError('Loan account not found');
      }

      const loan = loanRes.rows[0];
      const previousAgentId = loan.assigned_agent_id;
      let previousAgentName: string | null = null;
      if (previousAgentId) {
        const prevAgentRes = await client.query('SELECT full_name FROM users WHERE id = $1', [previousAgentId]);
        previousAgentName = prevAgentRes.rows[0]?.full_name || null;
      }

      if (!previousAgentId) {
        return {
          loanId,
          loanAccountNo: loan.loan_account_no,
          assignedAgentId: null,
          message: 'Loan was already unassigned',
        };
      }

      // Deactivate active assignments
      await client.query(
        `UPDATE collection_assignments
         SET is_active = FALSE, effective_to = CURRENT_DATE
         WHERE loan_id = $1 AND is_active = TRUE`,
        [loanId]
      );

      // Set loan.assigned_agent_id to NULL
      await client.query(
        'UPDATE loans SET assigned_agent_id = NULL, updated_at = NOW() WHERE id = $1',
        [loanId]
      );

      // Audit log
      await AuditService.log({
        userId: user.id,
        action: 'LOAN_RECOVERY_UNASSIGNED',
        entity: 'Loan',
        entityId: loanId,
        previousState: {
          loanId,
          loanAccountNo: loan.loan_account_no,
          assignedAgentId: previousAgentId,
          assignedAgentName: previousAgentName,
        },
        newState: {
          loanId,
          loanAccountNo: loan.loan_account_no,
          assignedAgentId: null,
          unassignedBy: user.id,
          reason: reason || null,
        },
      });

      return {
        loanId,
        loanAccountNo: loan.loan_account_no,
        assignedAgentId: null,
        previousAgentId,
        previousAgentName,
        unassignedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * Retrieve assignment history for a loan account.
   */
  public static async getLoanAssignmentHistory(loanId: string, user: AuthenticatedUser) {
    if (user.role === UserRole.COLLECTION_AGENT) {
      const accessCheck = await queryPostgres(
        `SELECT id FROM loans WHERE id = $1 AND assigned_agent_id = $2`,
        [loanId, user.id]
      );
      if (accessCheck.rows.length === 0) {
        throw new ForbiddenError('You do not have access to assignment history for this loan');
      }
    }

    const sql = `
      SELECT ca.id,
             ca.loan_id,
             ca.agent_id,
             u.full_name as agent_name,
             u.phone as agent_phone,
             ca.assigned_by,
             assigner.full_name as assigned_by_name,
             TO_CHAR(ca.effective_from, 'YYYY-MM-DD') as effective_from,
             TO_CHAR(ca.effective_to, 'YYYY-MM-DD') as effective_to,
             ca.is_active,
             ca.created_at
      FROM collection_assignments ca
      JOIN users u ON ca.agent_id = u.id
      JOIN users assigner ON ca.assigned_by = assigner.id
      WHERE ca.loan_id = $1
      ORDER BY ca.created_at DESC
    `;

    const res = await queryPostgres(sql, [loanId]);
    return res.rows.map((row: any) => ({
      id: row.id,
      loanId: row.loan_id,
      agentId: row.agent_id,
      agentName: row.agent_name,
      agentPhone: row.agent_phone,
      assignedBy: row.assigned_by,
      assignedByName: row.assigned_by_name,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
    }));
  }
}
