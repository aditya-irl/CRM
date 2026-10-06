import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { queryPostgres, closePostgresPool } from './postgres';
import {
  UserRole,
  UserStatus,
  KYCType,
  InterestMethod,
  RepaymentFrequency,
  LoanStatus,
  EMIStatus,
  PaymentMode,
  CallOutcome,
  generateAmortizationSchedule,
} from '@crm/shared';

export async function populateSampleData() {
  console.log('🚀 Populating rich sample CRM data into PostgreSQL...');

  const passwordHash = bcrypt.hashSync('Admin@123456', 10);
  const agentPasswordHash = bcrypt.hashSync('Agent@123456', 10);

  // 1. Users
  const adminId = 'a0000000-0000-0000-0000-000000000001';
  const managerId = 'a0000000-0000-0000-0000-000000000002';
  const agentRahulId = 'a0000000-0000-0000-0000-000000000003';
  const agentPriyaId = 'a0000000-0000-0000-0000-000000000004';
  const agentAmitId = 'a0000000-0000-0000-0000-000000000005';

  await queryPostgres(`
    INSERT INTO users (id, email, phone, password_hash, full_name, role, status, assigned_branch, created_at, updated_at)
    VALUES
      ($1, 'admin@financecrm.com', '+919876500001', $6, 'Mr. Sparsh', 'SUPER_ADMIN', 'ACTIVE', 'Headquarters', NOW(), NOW()),
      ($2, 'manager@financecrm.com', '+919876500002', $6, 'Anita Deshmukh (Branch Manager)', 'BRANCH_MANAGER', 'ACTIVE', 'North Branch', NOW(), NOW()),
      ($3, 'agent.rahul@financecrm.com', '+919876500003', $7, 'Rahul Sharma (Field Agent)', 'COLLECTION_AGENT', 'ACTIVE', 'North Branch', NOW(), NOW()),
      ($4, 'agent.priya@financecrm.com', '+919876500004', $7, 'Priya Verma (Field Agent)', 'COLLECTION_AGENT', 'ACTIVE', 'North Branch', NOW(), NOW()),
      ($5, 'agent.amit@financecrm.com', '+919876500005', $7, 'Amit Patel (Field Agent)', 'COLLECTION_AGENT', 'ACTIVE', 'South Branch', NOW(), NOW())
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name, status = 'ACTIVE'
  `, [adminId, managerId, agentRahulId, agentPriyaId, agentAmitId, passwordHash, agentPasswordHash]);

  const adminRow = (await queryPostgres("SELECT id FROM users WHERE email = 'admin@financecrm.com'")).rows[0];
  const rahulRow = (await queryPostgres("SELECT id FROM users WHERE email = 'agent.rahul@financecrm.com'")).rows[0];
  const priyaRow = (await queryPostgres("SELECT id FROM users WHERE email = 'agent.priya@financecrm.com'")).rows[0];
  const amitRow = (await queryPostgres("SELECT id FROM users WHERE email = 'agent.amit@financecrm.com'")).rows[0];

  const effectiveAdminId = adminRow ? adminRow.id : adminId;
  const effectiveRahulId = rahulRow ? rahulRow.id : agentRahulId;
  const effectivePriyaId = priyaRow ? priyaRow.id : agentPriyaId;
  const effectiveAmitId = amitRow ? amitRow.id : agentAmitId;

  // 1.5 Dealers / Partner Mobile Stores
  const dealerDefs = [
    {
      id: 'd0000000-0000-0000-0000-000000000001',
      code: 'DLR-000001',
      name: 'Rathore Mobile - Dadri',
      owner: 'Rakesh Kumar',
      phone: '9876543001',
      altPhone: '9876543002',
      email: 'rathore.dadri@example.com',
      address: 'Shop 14, Main Market, Railway Road',
      area: 'Dadri',
    },
    {
      id: 'd0000000-0000-0000-0000-000000000002',
      code: 'DLR-000002',
      name: 'Sharma Telecom - Alpha 1',
      owner: 'Anil Sharma',
      phone: '9876543003',
      altPhone: null,
      email: 'sharma.alpha1@example.com',
      address: 'Shop 22, Commercial Belt, Alpha 1',
      area: 'Alpha 1',
    },
    {
      id: 'd0000000-0000-0000-0000-000000000003',
      code: 'DLR-000003',
      name: 'Verma Electronics - Pari Chowk',
      owner: 'Sunil Verma',
      phone: '9876543004',
      altPhone: '9876543005',
      email: 'verma.parichowk@example.com',
      address: 'Plot 5, Near Metro Pillar 12',
      area: 'Pari Chowk',
    },
    {
      id: 'd0000000-0000-0000-0000-000000000004',
      code: 'DLR-000004',
      name: 'Gupta Mobile Point - Kasna',
      owner: 'Deepak Gupta',
      phone: '9876543006',
      altPhone: null,
      email: 'gupta.kasna@example.com',
      address: 'Main Kasna Chauraha, Kasna Village',
      area: 'Kasna',
    },
    {
      id: 'd0000000-0000-0000-0000-000000000005',
      code: 'DLR-000005',
      name: 'Singhal Digital - Noida Sector 62',
      owner: 'Pooja Singhal',
      phone: '9876543007',
      altPhone: '9876543008',
      email: 'singhal.sec62@example.com',
      address: 'Tower A, Tech Zone, Sector 62',
      area: 'Noida Sector 62',
    },
  ];

  const dealerIdMap = new Map<string, string>();
  for (const d of dealerDefs) {
    const existing = await queryPostgres<{ id: string }>(`SELECT id FROM dealers WHERE dealer_code = $1 OR store_name = $2 LIMIT 1`, [d.code, d.name]);
    let finalId = d.id;
    if (existing.rows && existing.rows.length > 0) {
      finalId = existing.rows[0].id;
      d.id = finalId;
      await queryPostgres(`
        UPDATE dealers
        SET store_name = $1, owner_name = $2, phone = $3, area_city = $4, status = 'ACTIVE', updated_at = NOW()
        WHERE id = $5
      `, [d.name, d.owner, d.phone, d.area, finalId]);
    } else {
      await queryPostgres(`
        INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, alternate_phone, email, address, area_city, status, created_by, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE', $10, NOW(), NOW())
      `, [d.id, d.code, d.name, d.owner, d.phone, d.altPhone, d.email, d.address, d.area, effectiveAdminId]);
    }
    dealerIdMap.set(d.code, finalId);
    dealerIdMap.set(`d0000000-0000-0000-0000-00000000000${d.code.slice(-1)}`, finalId);
  }

  console.log(`✓ Seeded ${dealerDefs.length} partner mobile stores.`);

  // 2. Customers Definition
  const customerDefs = [
    {
      code: 'CUST-2026-1001',
      name: 'Ramesh Kumar Gupta',
      phone: '+919811122334',
      altPhone: '+919811122335',
      address: 'Shop 14, Main Market, Sector 12',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110075',
      route: 'Sector-12 Market',
      photoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      agentId: effectiveRahulId,
    },
    {
      code: 'CUST-2026-1002',
      name: 'Pooja Singhania',
      phone: '+919822233445',
      altPhone: '+919822233446',
      address: 'Flat 402, Tower 8, Alpha 1 Commercial Belt',
      city: 'Greater Noida',
      state: 'Uttar Pradesh',
      pincode: '201308',
      route: 'Alpha 1',
      photoUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
      agentId: effectiveRahulId,
    },
    {
      code: 'CUST-2026-1003',
      name: 'Suresh Chand Sharma',
      phone: '+919833344556',
      altPhone: null,
      address: 'Plot 45, Street 3, Industrial Area Phase-1',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110020',
      route: 'Industrial Area Phase-1',
      photoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
      agentId: effectiveRahulId,
    },
    {
      code: 'CUST-2026-1004',
      name: 'Meena Devi Yadav',
      phone: '+919844455667',
      altPhone: '+919844455668',
      address: 'House 112, Gali No 4, Old City Bazaar',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110006',
      route: 'Old City Bazaar',
      photoUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
      agentId: effectivePriyaId,
    },
    {
      code: 'CUST-2026-1005',
      name: 'Anil Kumar Singh',
      phone: '+919855566778',
      altPhone: null,
      address: 'Flat 302, Green Valley Apts, Civil Lines',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110054',
      route: 'Civil Lines',
      photoUrl: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=150&auto=format&fit=crop&q=80',
      agentId: effectivePriyaId,
    },
    {
      code: 'CUST-2026-1006',
      name: 'Deepak Mohan Lal',
      phone: '+919866677889',
      altPhone: '+919866677890',
      address: 'Shop 88, Cloth Market, Dadri',
      city: 'Greater Noida',
      state: 'Uttar Pradesh',
      pincode: '203207',
      route: 'Dadri',
      photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      agentId: effectiveRahulId,
    },
    {
      code: 'CUST-2026-1007',
      name: 'Sunita Sharma',
      phone: '+919877788990',
      altPhone: null,
      address: 'House 44, Kasna Village Road',
      city: 'Greater Noida',
      state: 'Uttar Pradesh',
      pincode: '201310',
      route: 'Kasna',
      photoUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
      agentId: effectiveRahulId,
    },
    {
      code: 'CUST-2026-1008',
      name: 'Rajesh Verma',
      phone: '+919888899001',
      altPhone: '+919888899002',
      address: 'Plot 10, Pari Chowk Block B',
      city: 'Greater Noida',
      state: 'Uttar Pradesh',
      pincode: '201308',
      route: 'Pari Chowk',
      photoUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&auto=format&fit=crop&q=80',
      agentId: effectivePriyaId,
    },
    {
      code: 'CUST-2026-1009',
      name: 'Vikas Chauhan',
      phone: '+919899900112',
      altPhone: null,
      address: 'Tower B, Tech Zone, Sector 62',
      city: 'Noida',
      state: 'Uttar Pradesh',
      pincode: '201309',
      route: 'Noida Sector 62',
      photoUrl: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=150&auto=format&fit=crop&q=80',
      agentId: effectiveAmitId,
    },
    {
      code: 'CUST-2026-1010',
      name: 'Kavita Reddy',
      phone: '+919900011223',
      altPhone: '+919900011224',
      address: 'Villa 12, Alpha 2 Green Estate',
      city: 'Greater Noida',
      state: 'Uttar Pradesh',
      pincode: '201308',
      route: 'Alpha 1',
      photoUrl: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=150&auto=format&fit=crop&q=80',
      agentId: effectiveRahulId,
    },
    {
      code: 'CUST-2026-1011',
      name: 'Mohit Bansal',
      phone: '+919911122334',
      altPhone: null,
      address: 'Shop 2, Railway Road, Dadri',
      city: 'Greater Noida',
      state: 'Uttar Pradesh',
      pincode: '203207',
      route: 'Dadri',
      photoUrl: 'https://images.unsplash.com/photo-1528892952291-009c663ce843?w=150&auto=format&fit=crop&q=80',
      agentId: effectivePriyaId,
    },
    {
      code: 'CUST-2026-1012',
      name: 'Sanjay Aggarwal',
      phone: '+919922233445',
      altPhone: '+919922233446',
      address: 'B-12, Sector 18 Market',
      city: 'Noida',
      state: 'Uttar Pradesh',
      pincode: '201301',
      route: 'Noida Sector 62',
      photoUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80',
      agentId: effectiveAmitId,
    },
  ];

  const customerIdMap = new Map<string, string>();

  for (const c of customerDefs) {
    const custInsertRes = await queryPostgres(`
      INSERT INTO customers (
        id, customer_code, full_name, primary_phone, alternate_phone,
        address_line1, city, state, pincode, area_route, photo_url, is_active, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, $12, NOW(), NOW())
      ON CONFLICT (customer_code) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        primary_phone = EXCLUDED.primary_phone,
        area_route = EXCLUDED.area_route,
        photo_url = EXCLUDED.photo_url
      RETURNING id
    `, [uuidv4(), c.code, c.name, c.phone, c.altPhone, c.address, c.city, c.state, c.pincode, c.route, c.photoUrl, effectiveAdminId]);

    const actualCustomerId = custInsertRes.rows[0].id;
    customerIdMap.set(c.code, actualCustomerId);

    // Assignments
    await queryPostgres(`
      INSERT INTO collection_assignments (id, agent_id, customer_id, area_route, assigned_by, effective_from, is_active, created_at)
      VALUES ($1, $2, $3, $4, $5, '2026-01-01', TRUE, NOW())
      ON CONFLICT DO NOTHING
    `, [uuidv4(), c.agentId, actualCustomerId, c.route, effectiveAdminId]);

    // KYC Documents (Aadhaar & PAN)
    const kycDocs = [
      { type: 'AADHAAR', num: '9876-5432-1098', file: 'aadhaar_front.jpg', mime: 'image/jpeg' },
      { type: 'PAN', num: 'ABCDE1234F', file: 'pan_card.jpg', mime: 'image/jpeg' },
      { type: 'LOAN_AGREEMENT', num: 'AGR-2026-88', file: 'agreement.pdf', mime: 'application/pdf' },
    ];
    for (const k of kycDocs) {
      await queryPostgres(`
        INSERT INTO kyc_documents (
          id, customer_id, doc_type, doc_number_masked, storage_key, file_mime_type, file_size_bytes, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'VERIFIED', NOW())
        ON CONFLICT DO NOTHING
      `, [uuidv4(), actualCustomerId, k.type, k.num, `uploads/kyc/${c.code}_${k.file}`, k.mime, 120000]);
    }
  }

  console.log(`✓ Seeded ${customerDefs.length} customers with KYC and assignments.`);

  // 3. Loans, EMIs & Payments
  const loanConfigs = [
    {
      loanAcc: 'LN-2026-1001',
      customerCode: 'CUST-2026-1001',
      dealerId: 'd0000000-0000-0000-0000-000000000001', // Rathore Mobile - Dadri
      principal: 45000,
      downPayment: 5000,
      rate: 14,
      tenure: 12,
      disbDate: '2026-03-01',
      firstDue: '2026-04-01',
      status: LoanStatus.ACTIVE,
      paidInstallments: 5,
      hasDueToday: true,
      hasOverdue: false,
    },
    {
      loanAcc: 'LN-2026-1002',
      customerCode: 'CUST-2026-1002',
      dealerId: 'd0000000-0000-0000-0000-000000000002', // Sharma Telecom - Alpha 1
      principal: 75000,
      downPayment: 15000,
      rate: 12,
      tenure: 12,
      disbDate: '2026-02-15',
      firstDue: '2026-03-15',
      status: LoanStatus.ACTIVE,
      paidInstallments: 4,
      hasDueToday: false,
      hasOverdue: true,
      overdueDays: 45,
    },
    {
      loanAcc: 'LN-2026-1003',
      customerCode: 'CUST-2026-1003',
      dealerId: 'd0000000-0000-0000-0000-000000000003', // Verma Electronics - Pari Chowk
      principal: 30000,
      downPayment: 0,
      rate: 15,
      tenure: 6,
      disbDate: '2026-01-10',
      firstDue: '2026-02-10',
      status: LoanStatus.CLOSED,
      paidInstallments: 6,
      hasDueToday: false,
      hasOverdue: false,
    },
    {
      loanAcc: 'LN-2026-1004',
      customerCode: 'CUST-2026-1004',
      dealerId: 'd0000000-0000-0000-0000-000000000004', // Gupta Mobile Point - Kasna
      principal: 60000,
      downPayment: 10000,
      rate: 14,
      tenure: 12,
      disbDate: '2026-04-01',
      firstDue: '2026-05-01',
      status: LoanStatus.ACTIVE,
      paidInstallments: 3,
      hasDueToday: true,
      hasOverdue: false,
    },
    {
      loanAcc: 'LN-2026-1005',
      customerCode: 'CUST-2026-1005',
      dealerId: 'd0000000-0000-0000-0000-000000000005', // Singhal Digital - Noida Sector 62
      principal: 90000,
      downPayment: 20000,
      rate: 11,
      tenure: 18,
      disbDate: '2026-01-01',
      firstDue: '2026-02-01',
      status: LoanStatus.ACTIVE,
      paidInstallments: 4,
      hasDueToday: false,
      hasOverdue: true,
      overdueDays: 75,
    },
    {
      loanAcc: 'LN-2026-1006',
      customerCode: 'CUST-2026-1006',
      dealerId: 'd0000000-0000-0000-0000-000000000001', // Rathore Mobile - Dadri
      principal: 35000,
      downPayment: 5000,
      rate: 16,
      tenure: 6,
      disbDate: '2026-05-15',
      firstDue: '2026-06-15',
      status: LoanStatus.ACTIVE,
      paidInstallments: 3,
      hasDueToday: true,
      hasOverdue: false,
    },
    {
      loanAcc: 'LN-2026-1007',
      customerCode: 'CUST-2026-1007',
      dealerId: 'd0000000-0000-0000-0000-000000000004', // Gupta Mobile Point - Kasna
      principal: 50000,
      downPayment: 10000,
      rate: 13,
      tenure: 12,
      disbDate: '2026-03-20',
      firstDue: '2026-04-20',
      status: LoanStatus.ACTIVE,
      paidInstallments: 3,
      hasDueToday: false,
      hasOverdue: true,
      overdueDays: 18,
    },
    {
      loanAcc: 'LN-2026-1008',
      customerCode: 'CUST-2026-1008',
      dealerId: 'd0000000-0000-0000-0000-000000000003', // Verma Electronics - Pari Chowk
      principal: 40000,
      downPayment: 5000,
      rate: 15,
      tenure: 12,
      disbDate: '2026-06-01',
      firstDue: '2026-07-01',
      status: LoanStatus.ACTIVE,
      paidInstallments: 2,
      hasDueToday: true,
      hasOverdue: false,
    },
  ];

  for (const cfg of loanConfigs) {
    const custDef = customerDefs.find((c) => c.code === cfg.customerCode)!;
    const actualCustomerId = customerIdMap.get(cfg.customerCode)!;

    const sched = generateAmortizationSchedule({
      principalAmount: cfg.principal,
      downPayment: cfg.downPayment,
      annualInterestRate: cfg.rate,
      interestCalcMethod: InterestMethod.FLAT_RATE,
      tenureMonths: cfg.tenure,
      installmentFrequency: RepaymentFrequency.MONTHLY,
      disbursementDate: cfg.disbDate,
      firstEmiDate: cfg.firstDue,
    });

    const netDisbursed = sched.netDisbursedAmount;
    const emiAmt = sched.emiAmount;
    const totalPayable = sched.totalPayable;
    const totalInterest = sched.totalInterest;
    const totalPaid = emiAmt * cfg.paidInstallments;
    const outstanding = Math.max(0, totalPayable - totalPaid);

    const loanRes = await queryPostgres(`
      INSERT INTO loans (
        id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount,
        annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
        total_installments, emi_amount, total_interest, total_payable, total_paid,
        outstanding_balance, disbursement_date, first_emi_date, maturity_date,
        assigned_agent_id, status, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, NOW(), NOW())
      ON CONFLICT (loan_account_no) DO UPDATE SET
        dealer_id = EXCLUDED.dealer_id,
        total_paid = EXCLUDED.total_paid,
        outstanding_balance = EXCLUDED.outstanding_balance,
        status = EXCLUDED.status
      RETURNING id
    `, [
      uuidv4(),
      cfg.loanAcc,
      actualCustomerId,
      cfg.dealerId ? dealerIdMap.get(cfg.dealerId) || cfg.dealerId : null,
      cfg.principal,
      cfg.downPayment,
      netDisbursed,
      cfg.rate,
      InterestMethod.FLAT_RATE,
      cfg.tenure,
      RepaymentFrequency.MONTHLY,
      sched.schedule.length,
      emiAmt,
      totalInterest,
      totalPayable,
      totalPaid,
      outstanding,
      cfg.disbDate,
      cfg.firstDue,
      sched.schedule[sched.schedule.length - 1].dueDate,
      custDef.agentId,
      cfg.status,
      effectiveAdminId,
    ]);

    const actualLoanId = loanRes.rows[0].id;

    // Installments
    for (let i = 0; i < sched.schedule.length; i++) {
      const inst = sched.schedule[i];
      const instNumber = inst.installmentNumber;

      let instStatus = EMIStatus.UPCOMING;
      let paidAmt = 0;
      let remAmt = inst.expectedAmount;
      let penalty = 0;
      let daysOverdue = 0;
      let lastPayDate = null;

      if (instNumber <= cfg.paidInstallments) {
        instStatus = EMIStatus.PAID;
        paidAmt = inst.expectedAmount;
        remAmt = 0;
        lastPayDate = inst.dueDate;
      } else if (instNumber === cfg.paidInstallments + 1) {
        if (cfg.hasOverdue) {
          instStatus = EMIStatus.OVERDUE;
          daysOverdue = cfg.overdueDays || 30;
          penalty = 250;
        } else if (cfg.hasDueToday) {
          instStatus = EMIStatus.DUE_TODAY;
        }
      }

      const emiRes = await queryPostgres(`
        INSERT INTO emi_installments (
          id, loan_id, customer_id, installment_number, due_date,
          principal_component, interest_component, expected_amount,
          paid_amount, remaining_amount, penalty_amount, status,
          days_overdue, last_payment_date, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
        ON CONFLICT (loan_id, installment_number) DO UPDATE SET
          paid_amount = EXCLUDED.paid_amount,
          remaining_amount = EXCLUDED.remaining_amount,
          penalty_amount = EXCLUDED.penalty_amount,
          status = EXCLUDED.status,
          days_overdue = EXCLUDED.days_overdue
        RETURNING id
      `, [
        uuidv4(),
        actualLoanId,
        actualCustomerId,
        instNumber,
        inst.dueDate,
        inst.principalComponent,
        inst.interestComponent,
        inst.expectedAmount,
        paidAmt,
        remAmt,
        penalty,
        instStatus,
        daysOverdue,
        lastPayDate,
      ]);

      const actualEmiId = emiRes.rows[0].id;

      // If paid, create payment record
      if (instNumber <= cfg.paidInstallments) {
        const receiptNo = `REC-2026-${(10000 + i * 100 + parseInt(cfg.customerCode.slice(-2), 10)).toString()}`;
        const payMode = i % 2 === 0 ? PaymentMode.CASH : PaymentMode.UPI;

        await queryPostgres(`
          INSERT INTO payments (
            id, receipt_number, loan_id, emi_id, customer_id, amount,
            payment_mode, reference_number, collected_by_agent_id, payment_timestamp,
            status, is_reversal, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'SUCCESS', FALSE, NOW(), NOW())
          ON CONFLICT (receipt_number) DO NOTHING
        `, [
          uuidv4(),
          receiptNo,
          actualLoanId,
          actualEmiId,
          actualCustomerId,
          inst.expectedAmount,
          payMode,
          payMode === PaymentMode.UPI ? `UPI_${Date.now()}_${i}` : null,
          custDef.agentId,
          `${inst.dueDate} 14:30:00`,
        ]);
      }
    }

    // Call Logs for Active/Overdue Loans
    const callLogs = [
      {
        outcome: CallOutcome.PROMISED_TO_PAY,
        notes: `Spoke with borrower ${custDef.name}. Promised to clear installment by coming Friday.`,
        date: '2026-09-20',
      },
      {
        outcome: CallOutcome.RINGING,
        notes: 'Phone rang with no answer. Sent reminder over WhatsApp.',
        date: '2026-09-18',
      },
    ];

    for (const cl of callLogs) {
      await queryPostgres(`
        INSERT INTO call_logs (
          id, customer_id, loan_id, agent_id, call_timestamp, outcome,
          promised_payment_date, notes, contact_phone_used, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT DO NOTHING
      `, [
        uuidv4(),
        actualCustomerId,
        actualLoanId,
        custDef.agentId,
        `${cl.date} 11:00:00`,
        cl.outcome,
        cl.date === '2026-09-20' ? '2026-09-25' : null,
        cl.notes,
        custDef.phone,
      ]);
    }
  }

  console.log(`✓ Seeded ${loanConfigs.length} loans with full amortization schedules, payments, and recovery logs.`);
  console.log('🎉 Sample data population complete!');
}

if (require.main === module) {
  populateSampleData()
    .then(() => {
      console.log('Database seeded successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Failed to seed database:', err);
      process.exit(1);
    });
}

if (require.main === module) {
  populateSampleData()
    .then(() => closePostgresPool())
    .catch((err) => {
      console.error('Error seeding data:', err);
      process.exit(1);
    });
}
