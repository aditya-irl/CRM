import { v4 as uuidv4 } from 'uuid';
import Decimal from 'decimal.js';
import { queryPostgres, runPostgresTransaction } from '../../database/postgres';
import { AppError, NotFoundError, UnauthorizedError, ForbiddenError, ValidationError } from '../../middlewares/error.middleware';
import { CashfreeService } from '../../core/cashfree/cashfree.service';
import { PaymentService } from '../payments/payments.service';
import { PaymentMode, CollectionSource, UserRole } from '@crm/shared';
import { env } from '../../config/env';
import { PortalService } from './portal.service';

const PORTAL_BASE_URL = env.PORTAL_BASE_URL || process.env.PORTAL_BASE_URL || 'http://localhost:5173/portal';

export interface CreateOrderResult {
  orderId: string;
  paymentSessionId: string;
  orderAmount: number;
  orderCurrency: string;
  installmentNumber: number;
  dueDate: string;
  loanAccountNo: string;
  environment: 'sandbox' | 'production';
}

export interface VerifyOrderResult {
  status: 'SUCCESS' | 'PENDING' | 'FAILED' | 'USER_DROPPED' | 'CANCELLED';
  orderId: string;
  installmentNumber?: number;
  orderAmount: number;
  receiptNumber?: string;
  paymentId?: string;
  message?: string;
}

export class PortalPaymentService {
  /**
   * Securely create a Cashfree payment order for an outstanding EMI.
   * Derives customer and loan from validated portal token.
   * Calculates payable amount purely server-side from PostgreSQL records.
   */
  public static async createEmiOrder(
    rawToken: string,
    options: { installmentNumber?: number; emiId?: string } = {}
  ): Promise<CreateOrderResult> {
    // 1. Validate portal token and resolve active borrower context
    const tokenContext = await PortalService.validatePortalTokenContext(rawToken);

    // 2. Lock and load authoritative loan & customer records
    const loanRes = await queryPostgres(
      `SELECT l.id as loan_id, l.customer_id, l.loan_account_no, l.outstanding_balance,
              l.total_paid, l.status as loan_status,
              c.id as cust_id, c.full_name as customer_name, c.primary_phone,
              c.deleted_at as customer_deleted_at
       FROM loans l
       JOIN customers c ON c.id = l.customer_id
       WHERE l.id = $1`,
      [tokenContext.loanId]
    );

    if (loanRes.rows.length === 0) {
      throw new NotFoundError('Loan account not found');
    }

    const loan = loanRes.rows[0];

    if (loan.customer_deleted_at) {
      throw new ForbiddenError('Customer account is inactive or deleted');
    }

    if (loan.loan_status !== 'ACTIVE') {
      throw new ValidationError(`Loan account is not active for payment (status: ${loan.loan_status})`);
    }

    const outstandingBalance = Number(loan.outstanding_balance);
    if (outstandingBalance <= 0) {
      throw new ValidationError('Loan is already fully paid with zero outstanding balance');
    }

    // 3. Fetch all installments for this loan ordered chronologically
    const instRes = await queryPostgres(
      `SELECT id, installment_number, due_date, expected_amount, paid_amount,
              remaining_amount, penalty_amount, status
       FROM emi_installments
       WHERE loan_id = $1
       ORDER BY installment_number ASC`,
      [loan.loan_id]
    );

    if (instRes.rows.length === 0) {
      throw new NotFoundError('No EMI installments found for this loan');
    }

    let targetInst: any = null;

    if (options.installmentNumber !== undefined && options.installmentNumber !== null) {
      const num = Number(options.installmentNumber);
      targetInst = instRes.rows.find((r) => Number(r.installment_number) === num);
      if (!targetInst) {
        throw new NotFoundError(`Installment #${num} not found for this loan account`);
      }
      const rem = Number(targetInst.remaining_amount);
      const pen = Number(targetInst.penalty_amount || 0);
      if (rem <= 0 && pen <= 0) {
        throw new ValidationError(`Installment #${num} is already fully paid`);
      }
    } else if (options.emiId) {
      targetInst = instRes.rows.find((r) => r.id === options.emiId);
      if (!targetInst) {
        throw new NotFoundError('Selected installment was not found');
      }
      const rem = Number(targetInst.remaining_amount);
      const pen = Number(targetInst.penalty_amount || 0);
      if (rem <= 0 && pen <= 0) {
        throw new ValidationError('Selected installment is already fully paid');
      }
    } else {
      // Find oldest unpaid installment
      targetInst = instRes.rows.find(
        (r) => Number(r.remaining_amount) > 0 || Number(r.penalty_amount || 0) > 0
      );
      if (!targetInst) {
        throw new ValidationError('All installments for this loan are fully paid');
      }
    }

    // 4. Calculate authoritative payable amount strictly on server
    const instRemaining = new Decimal(targetInst.remaining_amount || 0);
    const instPenalty = new Decimal(targetInst.penalty_amount || 0);
    let payable = instRemaining.plus(instPenalty);

    if (payable.lessThanOrEqualTo(0)) {
      throw new ValidationError('Payable amount for this installment is zero');
    }

    // Cap at total loan outstanding balance plus penalty
    const totalLoanRemainingWithPenalties = new Decimal(outstandingBalance).plus(instPenalty);
    if (payable.greaterThan(totalLoanRemainingWithPenalties)) {
      payable = totalLoanRemainingWithPenalties;
    }

    const orderAmount = payable.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toNumber();

    // 5. Concurrency & duplicate-order protection:
    // Check if an ACTIVE Cashfree order was created in the last 15 minutes for this installment
    const existingOrderRes = await queryPostgres(
      `SELECT order_id, payment_session_id, order_amount, status, created_at
       FROM cashfree_orders
       WHERE loan_id = $1 AND emi_installment_id = $2 AND status = 'ACTIVE'
         AND created_at > NOW() - INTERVAL '15 minutes'
       ORDER BY created_at DESC LIMIT 1`,
      [loan.loan_id, targetInst.id]
    );

    if (existingOrderRes.rows.length > 0) {
      const activeOrder = existingOrderRes.rows[0];
      if (new Decimal(activeOrder.order_amount).equals(new Decimal(orderAmount)) && activeOrder.payment_session_id) {
        return {
          orderId: activeOrder.order_id,
          paymentSessionId: activeOrder.payment_session_id,
          orderAmount,
          orderCurrency: 'INR',
          installmentNumber: Number(targetInst.installment_number),
          dueDate: targetInst.due_date ? String(targetInst.due_date).slice(0, 10) : '',
          loanAccountNo: loan.loan_account_no,
          environment: CashfreeService.getEnvironment(),
        };
      }
    }

    // 6. Generate unique order ID (alphanumeric and underscores, under 50 characters)
    const orderNonce = uuidv4().replace(/-/g, '').slice(0, 12);
    const orderId = `CF_CRM_${Date.now().toString(36)}_${orderNonce}`;

    const returnUrl = `${PORTAL_BASE_URL}?token=${encodeURIComponent(rawToken.trim())}&order_id=${orderId}&payment_status=check`;

    // 7. Create Order on Cashfree Gateway
    const cfOrder = await CashfreeService.createOrder({
      orderId,
      orderAmount,
      orderCurrency: 'INR',
      customerDetails: {
        customerId: loan.customer_id,
        customerName: loan.customer_name,
        customerEmail: undefined,
        customerPhone: loan.primary_phone,
      },
      returnUrl,
      orderNote: `EMI #${targetInst.installment_number} for Loan ${loan.loan_account_no}`,
    });

    // 8. Persist internal order mapping in PostgreSQL
    await queryPostgres(
      `INSERT INTO cashfree_orders (
         id, order_id, payment_session_id, loan_id, customer_id, emi_installment_id,
         installment_number, order_amount, order_currency, status, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE', NOW(), NOW())`,
      [
        uuidv4(),
        orderId,
        cfOrder.paymentSessionId,
        loan.loan_id,
        loan.customer_id,
        targetInst.id,
        Number(targetInst.installment_number),
        orderAmount,
        'INR',
      ]
    );

    return {
      orderId,
      paymentSessionId: cfOrder.paymentSessionId,
      orderAmount,
      orderCurrency: 'INR',
      installmentNumber: Number(targetInst.installment_number),
      dueDate: targetInst.due_date ? String(targetInst.due_date).slice(0, 10) : '',
      loanAccountNo: loan.loan_account_no,
      environment: CashfreeService.getEnvironment(),
    };
  }

  /**
   * Reconcile and allocate a verified successful Cashfree payment.
   * Atomically integrates into the existing CRM payment ledger and waterfall allocation engine.
   */
  public static async processSuccessfulPayment(params: {
    orderId: string;
    cfPaymentId: string;
    gatewayAmount: number;
    paymentModeStr?: string;
    bankReference?: string;
    paymentTime?: string;
  }): Promise<{ paymentId: string; receiptNumber: string; isIdempotentReplay: boolean }> {
    const { orderId, cfPaymentId, gatewayAmount, paymentModeStr, bankReference, paymentTime } = params;

    // 1. Fetch order record
    const orderRes = await queryPostgres(
      `SELECT id, order_id, loan_id, customer_id, emi_installment_id, installment_number,
              order_amount, status, payment_id
       FROM cashfree_orders
       WHERE order_id = $1`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      throw new NotFoundError(`Cashfree order ${orderId} not found in database`);
    }

    const order = orderRes.rows[0];

    // 2. Idempotency Check: If order is already PAID with payment record, return existing receipt
    if (order.status === 'PAID' && order.payment_id) {
      const pmtRes = await queryPostgres('SELECT receipt_number FROM payments WHERE id = $1', [order.payment_id]);
      const receiptNumber = pmtRes.rows[0]?.receipt_number || '';
      return {
        paymentId: order.payment_id,
        receiptNumber,
        isIdempotentReplay: true,
      };
    }

    // 3. Amount Reconciliation
    const expectedAmount = new Decimal(order.order_amount);
    const paidAmount = new Decimal(gatewayAmount);
    if (!expectedAmount.equals(paidAmount)) {
      throw new AppError(
        `Amount mismatch: Gateway paid amount ₹${gatewayAmount} does not match order amount ₹${order.order_amount}`,
        400
      );
    }

    // 4. Map payment mode from gateway response (UPI or BANK_TRANSFER)
    let paymentMode = PaymentMode.UPI;
    if (paymentModeStr) {
      const lower = paymentModeStr.toLowerCase();
      if (lower.includes('netbanking') || lower.includes('card') || lower.includes('nb')) {
        paymentMode = PaymentMode.BANK_TRANSFER;
      }
    }

    // 5. Resolve system collector identity for ledger compliance
    const adminUserRes = await queryPostgres(
      `SELECT id, email, role, full_name FROM users WHERE role IN ('SUPER_ADMIN', 'ADMIN') AND status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1`
    );

    const recordingUser = adminUserRes.rows.length > 0 ? {
      id: adminUserRes.rows[0].id,
      email: adminUserRes.rows[0].email,
      role: adminUserRes.rows[0].role as UserRole,
      fullName: adminUserRes.rows[0].full_name || 'System Administrator',
    } : {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'system@crm.internal',
      role: UserRole.SUPER_ADMIN,
      fullName: 'System Automation',
    };

    // 6. Record payment via existing PaymentService (handles ACID locks, waterfall allocation, audit, receipt)
    const idempotencyKey = `cashfree_${cfPaymentId}`;

    const paymentResult = await PaymentService.recordPayment(
      {
        loanId: order.loan_id,
        customerId: order.customer_id,
        emiId: order.emi_installment_id,
        amount: expectedAmount.toNumber(),
        paymentMode,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        referenceNumber: `CF-${cfPaymentId}`,
        notes: `Online borrower payment via Cashfree Redirect Checkout (Order: ${order.order_id}, BankRef: ${bankReference || 'N/A'})`,
        idempotencyKey,
      },
      recordingUser
    );

    // 7. Update cashfree_orders row to mark status as PAID
    await queryPostgres(
      `UPDATE cashfree_orders
       SET status = 'PAID',
           cf_payment_id = $1,
           payment_id = $2,
           bank_reference = $3,
           payment_time = $4,
           payment_method = $5,
           updated_at = NOW()
       WHERE id = $6`,
      [
        cfPaymentId,
        paymentResult.id,
        bankReference || null,
        paymentTime ? new Date(paymentTime).toISOString() : new Date().toISOString(),
        paymentMode,
        order.id,
      ]
    );

    return {
      paymentId: paymentResult.id,
      receiptNumber: paymentResult.receiptNumber,
      isIdempotentReplay: false,
    };
  }

  /**
   * Verify order status server-to-server for returning Customer Portal sessions.
   */
  public static async verifyOrder(rawToken: string, orderId: string): Promise<VerifyOrderResult> {
    const tokenContext = await PortalService.validatePortalTokenContext(rawToken);

    // 1. Fetch order scoped to this borrower
    const orderRes = await queryPostgres(
      `SELECT o.id, o.order_id, o.loan_id, o.customer_id, o.emi_installment_id,
              o.installment_number, o.order_amount, o.status, o.payment_id, o.error_message,
              p.receipt_number
       FROM cashfree_orders o
       LEFT JOIN payments p ON p.id = o.payment_id
       WHERE o.order_id = $1 AND o.loan_id = $2 AND o.customer_id = $3`,
      [orderId, tokenContext.loanId, tokenContext.customerId]
    );

    if (orderRes.rows.length === 0) {
      throw new NotFoundError(`Payment order ${orderId} not found`);
    }

    const order = orderRes.rows[0];

    // If order is already processed and marked PAID in database
    if (order.status === 'PAID') {
      return {
        status: 'SUCCESS',
        orderId: order.order_id,
        installmentNumber: order.installment_number,
        orderAmount: Number(order.order_amount),
        receiptNumber: order.receipt_number,
        paymentId: order.payment_id,
      };
    }

    // If order was marked as failed or cancelled
    if (order.status === 'FAILED' || order.status === 'USER_DROPPED' || order.status === 'CANCELLED') {
      return {
        status: order.status,
        orderId: order.order_id,
        installmentNumber: order.installment_number,
        orderAmount: Number(order.order_amount),
        message: order.error_message || 'Payment attempt was not completed',
      };
    }

    // 2. Order is ACTIVE in DB: Query Cashfree server-to-server for real status
    try {
      const payments = await CashfreeService.getOrderPayments(order.order_id);

      // Check if any payment attempt succeeded
      const successfulPayment = payments.find((p) => p.paymentStatus === 'SUCCESS');
      if (successfulPayment) {
        const processResult = await this.processSuccessfulPayment({
          orderId: order.order_id,
          cfPaymentId: successfulPayment.cfPaymentId,
          gatewayAmount: successfulPayment.paymentAmount,
          paymentModeStr: successfulPayment.paymentGroup,
          bankReference: successfulPayment.bankReference,
          paymentTime: successfulPayment.paymentTime,
        });

        return {
          status: 'SUCCESS',
          orderId: order.order_id,
          installmentNumber: order.installment_number,
          orderAmount: Number(order.order_amount),
          receiptNumber: processResult.receiptNumber,
          paymentId: processResult.paymentId,
        };
      }

      // Check if user dropped or payment failed
      const droppedPayment = payments.find((p) => p.paymentStatus === 'USER_DROPPED');
      if (droppedPayment) {
        await queryPostgres(
          `UPDATE cashfree_orders SET status = 'USER_DROPPED', error_message = $1, updated_at = NOW() WHERE id = $2`,
          ['Checkout was cancelled by user', order.id]
        );
        return {
          status: 'USER_DROPPED',
          orderId: order.order_id,
          installmentNumber: order.installment_number,
          orderAmount: Number(order.order_amount),
          message: 'Payment checkout was cancelled.',
        };
      }

      const failedPayment = payments.find((p) => p.paymentStatus === 'FAILED');
      if (failedPayment) {
        await queryPostgres(
          `UPDATE cashfree_orders SET status = 'FAILED', error_message = $1, updated_at = NOW() WHERE id = $2`,
          [failedPayment.paymentMessage || 'Transaction failed', order.id]
        );
        return {
          status: 'FAILED',
          orderId: order.order_id,
          installmentNumber: order.installment_number,
          orderAmount: Number(order.order_amount),
          message: failedPayment.paymentMessage || 'Payment was declined by payment gateway.',
        };
      }
    } catch (err: any) {
      console.warn(`[PortalPaymentService:verifyOrder] Gateway status check warning for order ${order.order_id}:`, err.message);
    }

    return {
      status: 'PENDING',
      orderId: order.order_id,
      installmentNumber: order.installment_number,
      orderAmount: Number(order.order_amount),
      message: 'Payment is currently being processed by your bank.',
    };
  }
}
