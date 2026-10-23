import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { CashfreeService } from '../../core/cashfree/cashfree.service';
import { PortalPaymentService } from '../portal/portal-payment.service';
import { queryPostgres } from '../../database/postgres';

const router = Router();

/**
 * POST /api/v1/payments/cashfree/webhook
 * Dedicated Cashfree Webhook Handler.
 * Authenticated purely via official Cashfree HMAC-SHA256 signature verification.
 * Does NOT require user JWT.
 */
router.post('/webhook', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const timestamp = (req.headers['x-webhook-timestamp'] as string) || '';
    const signature = (req.headers['x-webhook-signature'] as string) || '';
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    console.log('[CashfreeWebhook] Received incoming webhook event:', {
      type: req.body?.type,
      orderId: req.body?.data?.order?.order_id,
      timestamp,
      hasSignature: Boolean(signature),
      hasRawBody: Boolean(rawBody),
    });

    // 1. Verify Cashfree Webhook Signature strictly
    const verification = CashfreeService.verifyWebhookSignature({
      timestamp,
      signature,
      rawBody,
    });

    if (!verification.valid) {
      console.warn('[CashfreeWebhook] Signature verification rejected:', verification.reason);
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_WEBHOOK_SIGNATURE',
          message: verification.reason || 'Cryptographic signature verification failed',
        },
        timestamp: new Date().toISOString(),
      });
    }

    const eventType = req.body?.type;
    const eventData = req.body?.data || {};
    const orderData = eventData.order || {};
    const paymentData = eventData.payment || {};
    const orderId = orderData.order_id;
    const cfPaymentId = paymentData.cf_payment_id ? String(paymentData.cf_payment_id) : undefined;
    const eventTime = req.body?.event_time || new Date().toISOString();

    // 2. Replay & Duplicate Event Protection
    const eventId = `${eventType}_${orderId || 'none'}_${cfPaymentId || 'none'}_${eventTime}`;
    const duplicateRes = await queryPostgres(
      'SELECT id FROM cashfree_webhook_events WHERE event_id = $1',
      [eventId]
    );

    if (duplicateRes.rows.length > 0) {
      console.log(`[CashfreeWebhook] Event ${eventId} already processed. Returning idempotent 200 OK.`);
      return res.status(200).json({
        success: true,
        message: 'Event already processed',
        timestamp: new Date().toISOString(),
      });
    }

    // 3. Process event according to Cashfree official event types
    if (eventType === 'PAYMENT_SUCCESS_WEBHOOK') {
      const paymentStatus = paymentData.payment_status;
      const paymentAmount = Number(paymentData.payment_amount);

      if (paymentStatus === 'SUCCESS' && orderId && cfPaymentId) {
        console.log(`[CashfreeWebhook] Processing PAYMENT_SUCCESS_WEBHOOK for order ${orderId}, payment ${cfPaymentId}`);
        await PortalPaymentService.processSuccessfulPayment({
          orderId,
          cfPaymentId,
          gatewayAmount: paymentAmount,
          paymentModeStr: paymentData.payment_group,
          bankReference: paymentData.bank_reference,
          paymentTime: paymentData.payment_time,
        });
      }
    } else if (eventType === 'PAYMENT_FAILED_WEBHOOK') {
      const failureMsg = paymentData.payment_message || req.body?.data?.error_details?.error_description || 'Payment failed at gateway';
      if (orderId) {
        await queryPostgres(
          `UPDATE cashfree_orders
           SET status = 'FAILED', error_message = $1, updated_at = NOW()
           WHERE order_id = $2 AND status != 'PAID'`,
          [failureMsg, orderId]
        );
      }
    } else if (eventType === 'PAYMENT_USER_DROPPED_WEBHOOK') {
      if (orderId) {
        await queryPostgres(
          `UPDATE cashfree_orders
           SET status = 'USER_DROPPED', error_message = 'Customer abandoned payment session', updated_at = NOW()
           WHERE order_id = $1 AND status != 'PAID'`,
          [orderId]
        );
      }
    }

    // 4. Record event in webhook audit log for replay protection
    await queryPostgres(
      `INSERT INTO cashfree_webhook_events (
         id, event_id, event_type, order_id, cf_payment_id, raw_payload, processed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        uuidv4(),
        eventId,
        eventType || 'UNKNOWN',
        orderId || null,
        cfPaymentId || null,
        JSON.stringify(req.body),
      ]
    );

    return res.status(200).json({
      success: true,
      message: 'Webhook processed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
