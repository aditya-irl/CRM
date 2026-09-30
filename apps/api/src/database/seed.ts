import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db, initDatabase } from './db';
import { queryPostgres } from './postgres';
import {
  UserRole,
  UserStatus,
  KYCType,
  KYCStatus,
  InterestMethod,
  RepaymentFrequency,
  LoanStatus,
  EMIStatus,
  PaymentMode,
  PaymentStatus,
  CallOutcome,
} from '@crm/shared';
import { generateAmortizationSchedule } from '@crm/shared';

export const SEED_ADMIN_ID = 'a0000000-0000-0000-0000-000000000001';
export const SEED_MANAGER_ID = 'a0000000-0000-0000-0000-000000000002';
export const SEED_AGENT_RAHUL_ID = 'a0000000-0000-0000-0000-000000000003';
export const SEED_AGENT_PRIYA_ID = 'a0000000-0000-0000-0000-000000000004';

export async function seedPostgres() {
  try {
    const adminCheck = await queryPostgres("SELECT id FROM users WHERE email = 'admin@financecrm.com'");
    if (adminCheck.rows.length > 0) {
      return;
    }

    console.log('[Seed] Seeding PostgreSQL database with default accounts...');
    const passwordHash = bcrypt.hashSync('Admin@123456', 10);
    const agentPasswordHash = bcrypt.hashSync('Agent@123456', 10);

    // 1. Insert Users
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, assigned_branch, created_at, updated_at)
      VALUES 
        ($1, 'admin@financecrm.com', '+919876500001', $5, 'Mr. Sparsh', 'SUPER_ADMIN', 'ACTIVE', 'Headquarters', NOW(), NOW()),
        ($2, 'manager@financecrm.com', '+919876500002', $5, 'Anita Deshmukh (Branch Manager)', 'BRANCH_MANAGER', 'ACTIVE', 'North Branch', NOW(), NOW()),
        ($3, 'agent.rahul@financecrm.com', '+919876500003', $6, 'Rahul Sharma (Field Agent)', 'COLLECTION_AGENT', 'ACTIVE', 'North Branch', NOW(), NOW()),
        ($4, 'agent.priya@financecrm.com', '+919876500004', $6, 'Priya Verma (Field Agent)', 'COLLECTION_AGENT', 'ACTIVE', 'North Branch', NOW(), NOW())
      ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name WHERE users.role = 'SUPER_ADMIN'
    `, [SEED_ADMIN_ID, SEED_MANAGER_ID, SEED_AGENT_RAHUL_ID, SEED_AGENT_PRIYA_ID, passwordHash, agentPasswordHash]);

    console.log('[Seed] PostgreSQL database seeded successfully.');
  } catch (err) {
    console.error('[Seed] PostgreSQL seeding error:', err);
  }
}

export function seedDatabase() {
  initDatabase();

  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count > 0) {
    db.prepare("UPDATE users SET full_name = 'Mr. Sparsh' WHERE role = 'SUPER_ADMIN'").run();
    return;
  }

  console.log('Seeding CRM Database with production-grade test data...');

  const passwordHash = bcrypt.hashSync('Admin@123456', 10);
  const agentPasswordHash = bcrypt.hashSync('Agent@123456', 10);
  const now = new Date().toISOString();

  // 1. Insert Users
  const adminId = SEED_ADMIN_ID;
  const managerId = SEED_MANAGER_ID;
  const agentRahulId = SEED_AGENT_RAHUL_ID;
  const agentPriyaId = SEED_AGENT_PRIYA_ID;

  const insertUser = db.prepare(`
    INSERT INTO users (id, email, phone, password_hash, full_name, role, status, assigned_branch, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run(adminId, 'admin@financecrm.com', '+919876500001', passwordHash, 'Mr. Sparsh', UserRole.SUPER_ADMIN, UserStatus.ACTIVE, 'Headquarters', now, now);
  insertUser.run(managerId, 'manager@financecrm.com', '+919876500002', passwordHash, 'Anita Deshmukh (Branch Manager)', UserRole.BRANCH_MANAGER, UserStatus.ACTIVE, 'North Branch', now, now);
  insertUser.run(agentRahulId, 'agent.rahul@financecrm.com', '+919876500003', agentPasswordHash, 'Rahul Sharma (Field Agent)', UserRole.COLLECTION_AGENT, UserStatus.ACTIVE, 'North Branch', now, now);
  insertUser.run(agentPriyaId, 'agent.priya@financecrm.com', '+919876500004', agentPasswordHash, 'Priya Verma (Field Agent)', UserRole.COLLECTION_AGENT, UserStatus.ACTIVE, 'North Branch', now, now);

  // 2. Insert Customers
  const customers = [
    {
      id: uuidv4(),
      code: 'CUST-2026-0001',
      name: 'Ramesh Kumar Gupta',
      phone: '+919811122334',
      address: 'Shop 14, Main Market, Sector 12',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110075',
      route: 'Sector-12 Market',
      agentId: agentRahulId,
    },
    {
      id: uuidv4(),
      code: 'CUST-2026-0002',
      name: 'Suresh Chand Sharma',
      phone: '+919822233445',
      address: 'Plot 45, Street 3, Industrial Area Phase-1',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110020',
      route: 'Industrial Area Phase-1',
      agentId: agentRahulId,
    },
    {
      id: uuidv4(),
      code: 'CUST-2026-0003',
      name: 'Meena Devi Yadav',
      phone: '+919833344556',
      address: 'House 112, Gali No 4, Old City Bazaar',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110006',
      route: 'Old City Bazaar',
      agentId: agentPriyaId,
    },
    {
      id: uuidv4(),
      code: 'CUST-2026-0004',
      name: 'Anil Kumar Singh',
      phone: '+919844455667',
      address: 'Flat 302, Green Valley Apts, Civil Lines',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110054',
      route: 'Civil Lines',
      agentId: agentPriyaId,
    },
    {
      id: uuidv4(),
      code: 'CUST-2026-0005',
      name: 'Deepak Mohan Lal',
      phone: '+919855566778',
      address: 'Shop 88, Cloth Market, Sector 12',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110075',
      route: 'Sector-12 Market',
      agentId: agentRahulId,
    },
  ];

  const insertCustomer = db.prepare(`
    INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, is_active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `);

  const insertAssignment = db.prepare(`
    INSERT INTO collection_assignments (id, agent_id, customer_id, area_route, assigned_by, effective_from, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `);

  const insertKYC = db.prepare(`
    INSERT INTO kyc_documents (id, customer_id, doc_type, doc_number_masked, storage_key, file_mime_type, file_size_bytes, status, verified_by, verified_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLoan = db.prepare(`
    INSERT INTO loans (
      id, loan_account_no, customer_id, principal_amount, down_payment, net_disbursed_amount,
      annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
      total_installments, emi_amount, total_interest, total_payable, total_paid,
      outstanding_balance, disbursement_date, first_emi_date, maturity_date,
      assigned_agent_id, status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertEmi = db.prepare(`
    INSERT INTO emi_installments (
      id, loan_id, customer_id, installment_number, due_date, principal_component,
      interest_component, expected_amount, paid_amount, remaining_amount, penalty_amount,
      status, days_overdue, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPayment = db.prepare(`
    INSERT INTO payments (
      id, receipt_number, loan_id, emi_id, customer_id, amount, payment_mode,
      reference_number, collected_by_agent_id, payment_timestamp, status, notes,
      is_reversal, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);

  const insertCallLog = db.prepare(`
    INSERT INTO call_logs (
      id, customer_id, loan_id, emi_id, agent_id, call_timestamp, outcome,
      promised_payment_date, next_follow_up_date, notes, contact_phone_used, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let idx = 0; idx < customers.length; idx++) {
    const c = customers[idx];
    insertCustomer.run(c.id, c.code, c.name, c.phone, c.address, c.city, c.state, c.pincode, c.route, adminId, now, now);

    // Assign route / customer to agent
    insertAssignment.run(uuidv4(), c.agentId, c.id, c.route, managerId, '2026-01-01', now);

    // Add KYC documents
    insertKYC.run(
      uuidv4(),
      c.id,
      KYCType.AADHAAR,
      `XXXX-XXXX-${9000 + idx}`,
      `kyc/${c.id}/aadhaar.pdf`,
      'application/pdf',
      245000,
      KYCStatus.VERIFIED,
      managerId,
      now,
      now
    );
    insertKYC.run(
      uuidv4(),
      c.id,
      KYCType.PAN,
      `ABCDE${1000 + idx}F`,
      `kyc/${c.id}/pan.jpg`,
      'image/jpeg',
      120000,
      KYCStatus.VERIFIED,
      managerId,
      now,
      now
    );

    // Generate sample loan with schedule
    const loanId = uuidv4();
    const loanAccNo = `LN-2026-${(1001 + idx).toString()}`;
    const principal = 60000 + idx * 20000;
    const rate = 14.0;
    const tenure = 12;

    const todayStr = new Date().toISOString().split('T')[0];
    const pastDisbDate = new Date();
    pastDisbDate.setMonth(pastDisbDate.getMonth() - (idx + 1));
    const disbDateStr = pastDisbDate.toISOString().split('T')[0];

    const calcResult = generateAmortizationSchedule({
      principalAmount: principal,
      annualInterestRate: rate,
      tenureMonths: tenure,
      installmentFrequency: RepaymentFrequency.MONTHLY,
      interestCalcMethod: InterestMethod.FLAT_RATE,
      disbursementDate: disbDateStr,
    });

    // Calculate paid amount and outstanding balance
    let loanTotalPaid = 0;
    calcResult.schedule.forEach((emi, emiIndex) => {
      if (emiIndex < idx) {
        loanTotalPaid += emi.expectedAmount;
      }
    });
    const outstanding = calcResult.totalPayable - loanTotalPaid;

    // 1. Insert Loan first to satisfy foreign key constraint
    insertLoan.run(
      loanId,
      loanAccNo,
      c.id,
      calcResult.principalAmount,
      0,
      calcResult.netDisbursedAmount,
      calcResult.annualInterestRate,
      calcResult.interestCalcMethod,
      calcResult.tenureMonths,
      calcResult.installmentFrequency,
      calcResult.totalInstallments,
      calcResult.emiAmount,
      calcResult.totalInterest,
      calcResult.totalPayable,
      loanTotalPaid,
      outstanding,
      calcResult.disbursementDate,
      calcResult.firstEmiDate,
      calcResult.maturityDate,
      c.agentId,
      LoanStatus.ACTIVE,
      adminId,
      now,
      now
    );

    // 2. Insert EMIs and Payments
    const emiIds: string[] = [];
    calcResult.schedule.forEach((emi, emiIndex) => {
      const emiId = uuidv4();
      emiIds.push(emiId);

      let emiStatus = EMIStatus.UPCOMING;
      let paidAmt = 0;
      let remainingAmt = emi.expectedAmount;
      let daysOverdue = 0;

      // Make earlier EMIs paid, one due today, one overdue for realism
      if (emiIndex < idx) {
        emiStatus = EMIStatus.PAID;
        paidAmt = emi.expectedAmount;
        remainingAmt = 0;
      } else if (emiIndex === idx) {
        if (idx % 2 === 0) {
          emiStatus = EMIStatus.DUE_TODAY;
          emi.dueDate = todayStr; // force to today for queue demo
        } else {
          emiStatus = EMIStatus.OVERDUE;
          daysOverdue = 15;
          remainingAmt = emi.expectedAmount;
        }
      }

      insertEmi.run(
        emiId,
        loanId,
        c.id,
        emi.installmentNumber,
        emi.dueDate,
        emi.principalComponent,
        emi.interestComponent,
        emi.expectedAmount,
        paidAmt,
        remainingAmt,
        0,
        emiStatus,
        daysOverdue,
        now,
        now
      );

      // If EMI was paid, record payment transaction
      if (paidAmt > 0) {
        insertPayment.run(
          uuidv4(),
          `RCP-2026-${(2000 + idx * 10 + emiIndex).toString()}`,
          loanId,
          emiId,
          c.id,
          paidAmt,
          PaymentMode.CASH,
          null,
          c.agentId,
          disbDateStr,
          PaymentStatus.SUCCESS,
          'Collected on time at customer shop',
          now,
          now
        );
      }
    });

    // Add Call log for overdue / due customers
    if (idx >= 1) {
      insertCallLog.run(
        uuidv4(),
        c.id,
        loanId,
        emiIds[idx],
        c.agentId,
        now,
        CallOutcome.PROMISED_TO_PAY,
        todayStr,
        todayStr,
        'Spoke with customer; promised cash collection today afternoon.',
        c.phone,
        now
      );
    }
  }

  // 3. Add initial audit log
  db.prepare(`
    INSERT INTO audit_logs (id, user_id, action, entity, entity_id, previous_state, new_state, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    adminId,
    'SYSTEM_INITIALIZED',
    'System',
    'SYSTEM',
    null,
    JSON.stringify({ seeded: true, customerCount: customers.length }),
    '127.0.0.1',
    now
  );

  console.log('Database seeded successfully.');
}
