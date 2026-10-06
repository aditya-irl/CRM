import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { queryPostgres, runPostgresTransaction } from '../../database/postgres';
import { db } from '../../database/db';
import { DealerStatus, UserRole, UserStatus } from '@crm/shared';
import { AppError, NotFoundError, ForbiddenError } from '../../middlewares/error.middleware';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { AuditService } from '../audit/audit.service';

export interface CreateDealerDTO {
  storeName: string;
  ownerName: string;
  phone: string;
  alternatePhone?: string | null;
  email?: string | null;
  address: string;
  areaCity: string;
  status?: DealerStatus;
}

export interface UpdateDealerDTO extends Partial<CreateDealerDTO> {}

export class DealerService {
  /**
   * List dealers with pagination, multi-field search, status filter, and financed loan counts.
   */
  public static async listDealers(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
      area?: string;
    },
    user?: AuthenticatedUser
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const offset = (page - 1) * limit;

    let sql = `
      SELECT d.*,
             u.id as user_id,
             u.status as user_status,
             u.must_change_password,
             (SELECT COUNT(*) FROM loans l WHERE l.dealer_id = d.id AND l.status = 'ACTIVE') as active_loans_count,
             (SELECT COUNT(*) FROM loans l WHERE l.dealer_id = d.id AND l.status = 'CLOSED') as closed_loans_count,
             (SELECT COUNT(DISTINCT l.customer_id) FROM loans l WHERE l.dealer_id = d.id) as total_customers_count
      FROM dealers d
      LEFT JOIN users u ON u.dealer_id = d.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    // Dealer RLAC: Dealers only see their own dealer record
    if (user && user.role === UserRole.DEALER) {
      sql += ` AND d.id = $${paramIndex++}`;
      params.push(user.dealerId);
    }

    if (query.status && query.status.toUpperCase() !== 'ALL') {
      sql += ` AND d.status = $${paramIndex++}`;
      params.push(query.status.toUpperCase());
    }

    if (query.area) {
      sql += ` AND d.area_city ILIKE $${paramIndex++}`;
      params.push(`%${query.area}%`);
    }

    if (query.search) {
      sql += ` AND (
        d.dealer_code ILIKE $${paramIndex}
        OR d.store_name ILIKE $${paramIndex}
        OR d.owner_name ILIKE $${paramIndex}
        OR d.phone ILIKE $${paramIndex}
        OR d.area_city ILIKE $${paramIndex}
      )`;
      params.push(`%${query.search}%`);
      paramIndex++;
    }

    // Count total matching records
    const countSql = `SELECT COUNT(*) as total FROM (${sql}) sub`;
    const countRes = await queryPostgres<{ total: string }>(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    sql += ` ORDER BY d.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await queryPostgres(sql, params);

    return {
      dealers: result.rows.map((d: any) => {
        // COLLECTION_AGENT RLAC projection:
        // Agents legitimately need the dealer list for the payment-source dropdown
        // (CollectionSource.DEALER), but do NOT need PII or account-management fields.
        // Return only the minimum safe fields sufficient for the dropdown UI.
        if (user && user.role === UserRole.COLLECTION_AGENT) {
          return {
            id: d.id,
            dealerCode: d.dealer_code,
            storeName: d.store_name,
            areaCity: d.area_city,
            status: d.status as DealerStatus,
          };
        }

        // Admin / Branch Manager / Dealer / SuperAdmin: full dealer-management response
        return {
          id: d.id,
          dealerCode: d.dealer_code,
          storeName: d.store_name,
          ownerName: d.owner_name,
          phone: d.phone,
          alternatePhone: d.alternate_phone,
          email: d.email,
          address: d.address,
          areaCity: d.area_city,
          status: d.status as DealerStatus,
          userId: d.user_id || null,
          userLoginId: d.user_id ? d.dealer_code : null,
          userStatus: d.user_status || null,
          mustChangePassword: d.must_change_password || false,
          activeLoansCount: Number(d.active_loans_count || 0),
          closedLoansCount: Number(d.closed_loans_count || 0),
          totalCustomersCount: Number(d.total_customers_count || 0),
          createdAt: d.created_at,
          updatedAt: d.updated_at,
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Retrieve single dealer by ID with loan aggregations and recent loans.
   */
  public static async getDealerById(id: string, user?: AuthenticatedUser) {
    if (user && user.role === UserRole.DEALER && user.dealerId !== id) {
      throw new ForbiddenError('You do not have access to another dealer\'s data');
    }

    const dealerSql = `
      SELECT d.*,
             u.id as user_id,
             u.status as user_status,
             u.must_change_password,
             (SELECT COUNT(*) FROM loans l WHERE l.dealer_id = d.id AND l.status = 'ACTIVE') as active_loans_count,
             (SELECT COUNT(*) FROM loans l WHERE l.dealer_id = d.id AND l.status = 'CLOSED') as closed_loans_count,
             (SELECT COUNT(DISTINCT l.customer_id) FROM loans l WHERE l.dealer_id = d.id) as total_customers_count
      FROM dealers d
      LEFT JOIN users u ON u.dealer_id = d.id
      WHERE d.id = $1
    `;

    const res = await queryPostgres(dealerSql, [id]);
    if (res.rows.length === 0) {
      throw new NotFoundError('Dealer not found');
    }

    const d = res.rows[0];

    // Fetch recent loans originated through this dealer
    const loansRes = await queryPostgres(
      `SELECT l.id, l.loan_account_no, l.principal_amount, l.emi_amount,
              l.outstanding_balance, l.status, l.disbursement_date,
              c.full_name as customer_name, c.customer_code, c.primary_phone
       FROM loans l
       JOIN customers c ON l.customer_id = c.id
       WHERE l.dealer_id = $1
       ORDER BY l.created_at DESC
       LIMIT 20`,
      [id]
    );

    return {
      dealer: {
        id: d.id,
        dealerCode: d.dealer_code,
        storeName: d.store_name,
        ownerName: d.owner_name,
        phone: d.phone,
        alternatePhone: d.alternate_phone,
        email: d.email,
        address: d.address,
        areaCity: d.area_city,
        status: d.status as DealerStatus,
        userId: d.user_id || null,
        userLoginId: d.user_id ? d.dealer_code : null,
        userStatus: d.user_status || null,
        mustChangePassword: d.must_change_password || false,
        activeLoansCount: Number(d.active_loans_count || 0),
        closedLoansCount: Number(d.closed_loans_count || 0),
        totalCustomersCount: Number(d.total_customers_count || 0),
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      },
      loans: loansRes.rows.map((l: any) => ({
        id: l.id,
        loanAccountNo: l.loan_account_no,
        customerName: l.customer_name,
        customerCode: l.customer_code,
        primaryPhone: l.primary_phone,
        principalAmount: Number(l.principal_amount),
        emiAmount: Number(l.emi_amount),
        outstandingBalance: Number(l.outstanding_balance),
        status: l.status,
        disbursementDate: l.disbursement_date,
      })),
    };
  }

  /**
   * Create a new Dealer / Mobile Store record.
   */
  public static async createDealer(data: CreateDealerDTO, user: AuthenticatedUser) {
    const id = uuidv4();

    // Generate unique sequential dealer code: DLR-000001
    const countRes = await queryPostgres<{ count: string }>('SELECT COUNT(*) as count FROM dealers');
    const totalCount = parseInt(countRes.rows[0]?.count || '0', 10);
    const dealerCode = `DLR-${String(totalCount + 1).padStart(6, '0')}`;

    const status = data.status || DealerStatus.ACTIVE;

    const sql = `
      INSERT INTO dealers (
        id, dealer_code, store_name, owner_name, phone, alternate_phone,
        email, address, area_city, status, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      RETURNING *
    `;

    const result = await queryPostgres(sql, [
      id,
      dealerCode,
      data.storeName.trim(),
      data.ownerName.trim(),
      data.phone.trim(),
      data.alternatePhone?.trim() || null,
      data.email?.trim() || null,
      data.address.trim(),
      data.areaCity.trim(),
      status,
      user.id,
    ]);

    const created = result.rows[0];

    // Sync to SQLite fallback
    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO dealers (
          id, dealer_code, store_name, owner_name, phone, alternate_phone,
          email, address, area_city, status, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        dealerCode,
        data.storeName.trim(),
        data.ownerName.trim(),
        data.phone.trim(),
        data.alternatePhone?.trim() || null,
        data.email?.trim() || null,
        data.address.trim(),
        data.areaCity.trim(),
        status,
        user.id,
        now,
        now
      );
    } catch {
      // Safe fallback
    }

    // Write immutable audit log
    await AuditService.log({
      userId: user.id,
      action: 'DEALER_CREATED',
      entity: 'Dealer',
      entityId: id,
      newState: {
        dealerCode,
        storeName: data.storeName.trim(),
        ownerName: data.ownerName.trim(),
        phone: data.phone.trim(),
        areaCity: data.areaCity.trim(),
        status,
      },
    });

    return {
      id: created.id,
      dealerCode: created.dealer_code,
      storeName: created.store_name,
      ownerName: created.owner_name,
      phone: created.phone,
      alternatePhone: created.alternate_phone,
      email: created.email,
      address: created.address,
      areaCity: created.area_city,
      status: created.status as DealerStatus,
      createdAt: created.created_at,
      updatedAt: created.updated_at,
    };
  }

  /**
   * Edit existing dealer profile (excluding dealer code).
   */
  public static async updateDealer(id: string, data: UpdateDealerDTO, user: AuthenticatedUser) {
    const checkRes = await queryPostgres('SELECT * FROM dealers WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) {
      throw new NotFoundError('Dealer not found');
    }

    const previous = checkRes.rows[0];

    const updatedStoreName = data.storeName !== undefined ? data.storeName.trim() : previous.store_name;
    const updatedOwnerName = data.ownerName !== undefined ? data.ownerName.trim() : previous.owner_name;
    const updatedPhone = data.phone !== undefined ? data.phone.trim() : previous.phone;
    const updatedAltPhone = data.alternatePhone !== undefined ? (data.alternatePhone?.trim() || null) : previous.alternate_phone;
    const updatedEmail = data.email !== undefined ? (data.email?.trim() || null) : previous.email;
    const updatedAddress = data.address !== undefined ? data.address.trim() : previous.address;
    const updatedAreaCity = data.areaCity !== undefined ? data.areaCity.trim() : previous.area_city;

    const sql = `
      UPDATE dealers
      SET store_name = $1, owner_name = $2, phone = $3, alternate_phone = $4,
          email = $5, address = $6, area_city = $7, updated_at = NOW()
      WHERE id = $8
      RETURNING *
    `;

    const result = await queryPostgres(sql, [
      updatedStoreName,
      updatedOwnerName,
      updatedPhone,
      updatedAltPhone,
      updatedEmail,
      updatedAddress,
      updatedAreaCity,
      id,
    ]);

    const updated = result.rows[0];

    // Sync to SQLite fallback
    try {
      db.prepare(`
        UPDATE dealers
        SET store_name = ?, owner_name = ?, phone = ?, alternate_phone = ?,
            email = ?, address = ?, area_city = ?, updated_at = ?
        WHERE id = ?
      `).run(
        updatedStoreName,
        updatedOwnerName,
        updatedPhone,
        updatedAltPhone,
        updatedEmail,
        updatedAddress,
        updatedAreaCity,
        new Date().toISOString(),
        id
      );
    } catch {
      // Safe fallback
    }

    // Write immutable audit log
    await AuditService.log({
      userId: user.id,
      action: 'DEALER_UPDATED',
      entity: 'Dealer',
      entityId: id,
      previousState: {
        storeName: previous.store_name,
        ownerName: previous.owner_name,
        phone: previous.phone,
        alternatePhone: previous.alternate_phone,
        email: previous.email,
        address: previous.address,
        areaCity: previous.area_city,
      },
      newState: {
        storeName: updatedStoreName,
        ownerName: updatedOwnerName,
        phone: updatedPhone,
        alternatePhone: updatedAltPhone,
        email: updatedEmail,
        address: updatedAddress,
        areaCity: updatedAreaCity,
      },
    });

    return {
      id: updated.id,
      dealerCode: updated.dealer_code,
      storeName: updated.store_name,
      ownerName: updated.owner_name,
      phone: updated.phone,
      alternatePhone: updated.alternate_phone,
      email: updated.email,
      address: updated.address,
      areaCity: updated.area_city,
      status: updated.status as DealerStatus,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    };
  }

  /**
   * Activate or Deactivate dealer.
   */
  public static async updateDealerStatus(id: string, status: DealerStatus, user: AuthenticatedUser) {
    const checkRes = await queryPostgres('SELECT * FROM dealers WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) {
      throw new NotFoundError('Dealer not found');
    }

    const previous = checkRes.rows[0];

    await queryPostgres(
      'UPDATE dealers SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, id]
    );

    // Sync to SQLite fallback
    try {
      db.prepare('UPDATE dealers SET status = ?, updated_at = ? WHERE id = ?').run(
        status,
        new Date().toISOString(),
        id
      );
    } catch {
      // Safe fallback
    }

    const action = status === DealerStatus.ACTIVE ? 'DEALER_ACTIVATED' : 'DEALER_DEACTIVATED';

    await AuditService.log({
      userId: user.id,
      action,
      entity: 'Dealer',
      entityId: id,
      previousState: { status: previous.status },
      newState: { status },
    });

    return {
      id,
      dealerCode: previous.dealer_code,
      storeName: previous.store_name,
      status,
    };
  }

  /**
   * Helper to generate cryptographically secure, high-entropy temporary passwords (22+ characters).
   * Uses crypto.randomInt and avoids visually ambiguous characters (O, 0, I, l, 1).
   */
  public static generateTempPassword(_storeName?: string): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // 24 chars (excluding I, O)
    const lower = 'abcdefghijkmnopqrstuvwxyz'; // 25 chars (excluding l)
    const digits = '23456789';                 // 8 chars (excluding 0, 1)
    const special = '!@#$%^&*()_+-=';          // 14 chars
    const all = upper + lower + digits + special; // 71 chars

    const chars: string[] = [
      upper[crypto.randomInt(upper.length)],
      upper[crypto.randomInt(upper.length)],
      lower[crypto.randomInt(lower.length)],
      lower[crypto.randomInt(lower.length)],
      digits[crypto.randomInt(digits.length)],
      digits[crypto.randomInt(digits.length)],
      special[crypto.randomInt(special.length)],
      special[crypto.randomInt(special.length)],
    ];

    // Total 22 characters: fill remaining 14 chars from 'all'
    for (let i = 0; i < 14; i++) {
      chars.push(all[crypto.randomInt(all.length)]);
    }

    // Durstenfeld/Fisher-Yates shuffle using crypto.randomInt
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars.join('');
  }

  /**
   * Create a unique login account for a dealer store.
   */
  public static async createDealerLogin(dealerId: string, currentUser: AuthenticatedUser) {
    const dealerRes = await queryPostgres('SELECT * FROM dealers WHERE id = $1', [dealerId]);
    if (dealerRes.rows.length === 0) {
      throw new NotFoundError('Dealer not found');
    }
    const dealer = dealerRes.rows[0];

    const existingUser = await queryPostgres('SELECT id FROM users WHERE dealer_id = $1', [dealerId]);
    if (existingUser.rows.length > 0) {
      throw new AppError('A login account already exists for this dealer');
    }

    const tempPassword = this.generateTempPassword(dealer.store_name);
    const passwordHash = bcrypt.hashSync(tempPassword, 10);
    const userId = uuidv4();

    await runPostgresTransaction(async (client) => {
      await client.query(
        `INSERT INTO users (
          id, email, phone, password_hash, full_name, role, status,
          dealer_id, must_change_password, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        [
          userId,
          dealer.dealer_code,
          dealer.phone || null,
          passwordHash,
          dealer.owner_name || dealer.store_name,
          UserRole.DEALER,
          UserStatus.ACTIVE,
          dealer.id,
          true,
        ]
      );

      await client.query(
        'UPDATE dealers SET user_id = $1, updated_at = NOW() WHERE id = $2',
        [userId, dealer.id]
      );
    });

    // Write immutable audit log (NEVER log password)
    await AuditService.log({
      userId: currentUser.id,
      action: 'DEALER_LOGIN_CREATED',
      entity: 'Dealer',
      entityId: dealer.id,
      newState: {
        dealerId: dealer.id,
        dealerCode: dealer.dealer_code,
        storeName: dealer.store_name,
        userId,
      },
    });

    return {
      dealerId: dealer.id,
      loginId: dealer.dealer_code,
      temporaryPassword: tempPassword,
      mustChangePassword: true,
      user: {
        id: userId,
        email: dealer.dealer_code,
        role: UserRole.DEALER,
        dealerId: dealer.id,
      },
    };
  }

  /**
   * Reset a dealer's password and issue a new secure temporary password.
   */
  public static async resetDealerPassword(dealerId: string, currentUser: AuthenticatedUser) {
    const dealerRes = await queryPostgres('SELECT * FROM dealers WHERE id = $1', [dealerId]);
    if (dealerRes.rows.length === 0) {
      throw new NotFoundError('Dealer not found');
    }
    const dealer = dealerRes.rows[0];

    const userRes = await queryPostgres('SELECT id FROM users WHERE dealer_id = $1', [dealerId]);
    if (userRes.rows.length === 0) {
      throw new NotFoundError('No login account exists for this dealer');
    }
    const targetUserId = userRes.rows[0].id;

    const tempPassword = this.generateTempPassword(dealer.store_name);
    const passwordHash = bcrypt.hashSync(tempPassword, 10);

    await queryPostgres(
      'UPDATE users SET password_hash = $1, must_change_password = TRUE, updated_at = NOW() WHERE id = $2',
      [passwordHash, targetUserId]
    );

    // Audit log (NEVER log password)
    await AuditService.log({
      userId: currentUser.id,
      action: 'DEALER_PASSWORD_RESET',
      entity: 'Dealer',
      entityId: dealer.id,
      newState: {
        dealerId: dealer.id,
        dealerCode: dealer.dealer_code,
        userId: targetUserId,
      },
    });

    return {
      dealerId: dealer.id,
      loginId: dealer.dealer_code,
      temporaryPassword: tempPassword,
      mustChangePassword: true,
      user: {
        id: targetUserId,
        email: dealer.dealer_code,
        role: UserRole.DEALER,
        dealerId: dealer.id,
      },
    };
  }

  /**
   * Enable or disable dealer user login access.
   */
  public static async updateDealerLoginStatus(
    dealerId: string,
    status: UserStatus,
    currentUser: AuthenticatedUser
  ) {
    const userRes = await queryPostgres('SELECT id, status FROM users WHERE dealer_id = $1', [dealerId]);
    if (userRes.rows.length === 0) {
      throw new NotFoundError('No login account exists for this dealer');
    }
    const targetUser = userRes.rows[0];

    await queryPostgres(
      'UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, targetUser.id]
    );

    await AuditService.log({
      userId: currentUser.id,
      action: 'DEALER_LOGIN_STATUS_UPDATED',
      entity: 'User',
      entityId: targetUser.id,
      previousState: { status: targetUser.status },
      newState: { status },
    });

    return {
      dealerId,
      userId: targetUser.id,
      status,
    };
  }

  /**
   * Retrieve store-scoped Dealer Dashboard metrics and recent transactions.
   */
  public static async getDealerDashboard(user: AuthenticatedUser, requestedDealerId?: string) {
    let targetDealerId: string | null = null;
    if (user.role === UserRole.DEALER) {
      if (!user.dealerId) {
        throw new ForbiddenError('Dealer context missing in authenticated user session');
      }
      targetDealerId = user.dealerId;
    } else {
      targetDealerId = requestedDealerId || null;
      if (!targetDealerId) {
        throw new AppError('Dealer ID is required');
      }
    }

    const dealerRes = await queryPostgres(
      `SELECT d.*, u.id as user_id, u.status as user_status, u.must_change_password
       FROM dealers d
       LEFT JOIN users u ON u.dealer_id = d.id
       WHERE d.id = $1`,
      [targetDealerId]
    );

    if (dealerRes.rows.length === 0) {
      throw new NotFoundError('Dealer not found');
    }

    const d = dealerRes.rows[0];

    // Compute dealer-scoped metrics
    const metricsRes = await queryPostgres(
      `SELECT
        (SELECT COUNT(DISTINCT customer_id) FROM loans WHERE dealer_id = $1) as total_customers,
        (SELECT COUNT(*) FROM loans WHERE dealer_id = $1 AND status = 'ACTIVE') as active_loans,
        (SELECT COUNT(*) FROM loans WHERE dealer_id = $1 AND status = 'CLOSED') as closed_loans,
        (SELECT COALESCE(SUM(principal_amount), 0) FROM loans WHERE dealer_id = $1) as total_financed_amount,
        (SELECT COALESCE(SUM(outstanding_balance), 0) FROM loans WHERE dealer_id = $1 AND status = 'ACTIVE') as total_outstanding_balance,
        (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE dealer_id = $1 AND collection_source = 'DEALER' AND status = 'SUCCESS' AND is_reversal = FALSE) as total_collected_amount,
        (SELECT COALESCE(SUM(amount), 0) FROM dealer_settlements WHERE dealer_id = $1 AND status = 'COMPLETED') as total_settled_amount
      `,
      [targetDealerId]
    );

    const m = metricsRes.rows[0];
    const totalCollected = Number(m.total_collected_amount || 0);
    const totalSettled = Number(m.total_settled_amount || 0);
    const unsettledCollection = Math.max(0, totalCollected - totalSettled);

    // Recent loans (10)
    const loansRes = await queryPostgres(
      `SELECT l.id, l.loan_account_no, l.principal_amount, l.emi_amount,
              l.outstanding_balance, l.status, l.disbursement_date,
              c.full_name as customer_name, c.customer_code, c.primary_phone
       FROM loans l
       JOIN customers c ON l.customer_id = c.id
       WHERE l.dealer_id = $1
       ORDER BY l.created_at DESC
       LIMIT 10`,
      [targetDealerId]
    );

    // Recent collections (10)
    const collectionsRes = await queryPostgres(
      `SELECT p.id, p.receipt_number, p.amount, p.payment_timestamp as payment_date, p.payment_mode, p.status,
              c.full_name as customer_name, l.loan_account_no,
              CASE WHEN sa.settlement_id IS NOT NULL THEN 'SETTLED' ELSE 'UNSETTLED' END as settlement_status
       FROM payments p
       JOIN loans l ON p.loan_id = l.id
       JOIN customers c ON l.customer_id = c.id
       LEFT JOIN dealer_settlement_allocations sa ON sa.payment_id = p.id
       WHERE (p.dealer_id = $1 OR l.dealer_id = $1)
       ORDER BY p.payment_timestamp DESC
       LIMIT 10`,
      [targetDealerId]
    );

    // Recent settlements (10)
    const settlementsRes = await queryPostgres(
      `SELECT id, settlement_number as settlement_reference, amount as total_amount, settlement_date, payment_method, status
       FROM dealer_settlements
       WHERE dealer_id = $1
       ORDER BY settlement_date DESC
       LIMIT 10`,
      [targetDealerId]
    );

    return {
      dealer: {
        id: d.id,
        dealerCode: d.dealer_code,
        storeName: d.store_name,
        ownerName: d.owner_name,
        phone: d.phone,
        alternatePhone: d.alternate_phone,
        email: d.email,
        address: d.address,
        areaCity: d.area_city,
        status: d.status as DealerStatus,
        userId: d.user_id || null,
        userLoginId: d.user_id ? d.dealer_code : null,
        userStatus: d.user_status || null,
        mustChangePassword: d.must_change_password || false,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      },
      metrics: {
        totalCustomers: Number(m.total_customers || 0),
        activeLoans: Number(m.active_loans || 0),
        closedLoans: Number(m.closed_loans || 0),
        totalFinancedAmount: Number(m.total_financed_amount || 0),
        totalOutstandingBalance: Number(m.total_outstanding_balance || 0),
        totalCollectedAmount: totalCollected,
        unsettledCollectionAmount: unsettledCollection,
        totalSettledAmount: totalSettled,
      },
      recentLoans: loansRes.rows.map((l: any) => ({
        id: l.id,
        loanAccountNo: l.loan_account_no,
        customerName: l.customer_name,
        customerCode: l.customer_code,
        primaryPhone: l.primary_phone,
        principalAmount: Number(l.principal_amount),
        emiAmount: Number(l.emi_amount),
        outstandingBalance: Number(l.outstanding_balance),
        status: l.status,
        disbursementDate: l.disbursement_date,
      })),
      recentCollections: collectionsRes.rows.map((c: any) => ({
        id: c.id,
        receiptNumber: c.receipt_number,
        customerName: c.customer_name,
        loanAccountNo: c.loan_account_no,
        amount: Number(c.amount),
        paymentDate: c.payment_date,
        paymentMode: c.payment_mode,
        status: c.status,
        settlementStatus: c.settlement_status,
      })),
      recentSettlements: settlementsRes.rows.map((s: any) => ({
        id: s.id,
        settlementReference: s.settlement_reference,
        totalAmount: Number(s.total_amount),
        settlementDate: s.settlement_date,
        paymentMethod: s.payment_method,
        status: s.status,
      })),
    };
  }

  /**
   * Delete a partner retail store.
   * Safety rule: Destructive deletion is blocked if any linked customers, loans, payments,
   * settlements, or other financial records exist. In that case, returns a clear explanatory
   * message advising deactivation instead.
   */
  public static async deleteDealer(id: string, currentUser: AuthenticatedUser) {
    const dealerRes = await queryPostgres('SELECT * FROM dealers WHERE id = $1', [id]);
    if (dealerRes.rows.length === 0) {
      throw new NotFoundError('Dealer not found');
    }
    const dealer = dealerRes.rows[0];

    // Check all linked financial and operational records
    const [custRes, loansRes, paymentsRes, settlementsRes] = await Promise.all([
      queryPostgres('SELECT COUNT(DISTINCT customer_id)::int as count FROM loans WHERE dealer_id = $1', [id]),
      queryPostgres('SELECT COUNT(*)::int as count FROM loans WHERE dealer_id = $1', [id]),
      queryPostgres('SELECT COUNT(*)::int as count FROM payments WHERE dealer_id = $1', [id]),
      queryPostgres('SELECT COUNT(*)::int as count FROM dealer_settlements WHERE dealer_id = $1', [id]),
    ]);

    const linkedCustomers = parseInt(custRes.rows[0]?.count || '0', 10);
    const linkedLoans = parseInt(loansRes.rows[0]?.count || '0', 10);
    const linkedPayments = parseInt(paymentsRes.rows[0]?.count || '0', 10);
    const linkedSettlements = parseInt(settlementsRes.rows[0]?.count || '0', 10);

    if (linkedCustomers > 0 || linkedLoans > 0 || linkedPayments > 0 || linkedSettlements > 0) {
      const reasons: string[] = [];
      if (linkedCustomers > 0) reasons.push(`${linkedCustomers} linked customer(s)`);
      if (linkedLoans > 0) reasons.push(`${linkedLoans} loan agreement(s)`);
      if (linkedPayments > 0) reasons.push(`${linkedPayments} payment record(s)`);
      if (linkedSettlements > 0) reasons.push(`${linkedSettlements} settlement(s)`);

      throw new AppError(
        `Cannot delete partner store "${dealer.store_name}" because active financial history exists (${reasons.join(', ')}). Please deactivate the store instead to preserve financial records and regulatory audit history.`,
        400
      );
    }

    // Safe to delete cleanly: remove user account if any and dealer record
    await runPostgresTransaction(async (client) => {
      await client.query('DELETE FROM users WHERE dealer_id = $1', [id]);
      await client.query('DELETE FROM dealers WHERE id = $1', [id]);
    });

    // Write immutable audit log
    await AuditService.log({
      userId: currentUser.id,
      action: 'DEALER_DELETED',
      entity: 'Dealer',
      entityId: id,
      previousState: {
        dealerCode: dealer.dealer_code,
        storeName: dealer.store_name,
        ownerName: dealer.owner_name,
        phone: dealer.phone,
      },
    });

    return {
      success: true,
      message: `Partner store "${dealer.store_name}" (${dealer.dealer_code}) was deleted successfully.`,
    };
  }
}
