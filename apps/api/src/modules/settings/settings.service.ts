import { queryPostgres } from '../../database/postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { AppError } from '../../middlewares/error.middleware';

export class SettingsService {
  /**
   * Check whether dealers are currently allowed to add late payment penalties.
   * Defaults to false (OFF) if not set.
   */
  public static async isDealerPenaltyAllowed(): Promise<boolean> {
    const res = await queryPostgres(
      `SELECT value FROM system_settings WHERE key = 'ALLOW_DEALER_PENALTY'`
    );
    if (res.rows.length === 0) {
      return false;
    }
    const val = res.rows[0].value;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') return val.toLowerCase() === 'true';
    if (val && typeof val === 'object' && 'enabled' in val) return Boolean(val.enabled);
    return Boolean(val);
  }

  /**
   * Retrieve the current dealer penalty permission setting.
   */
  public static async getDealerPenaltySetting(): Promise<{ allowDealerPenalty: boolean }> {
    const allowed = await this.isDealerPenaltyAllowed();
    return { allowDealerPenalty: allowed };
  }

  /**
   * Update the dealer penalty permission setting (SUPER_ADMIN only).
   */
  public static async setDealerPenaltySetting(
    allowed: boolean,
    user: AuthenticatedUser
  ): Promise<{ allowDealerPenalty: boolean }> {
    if (typeof allowed !== 'boolean') {
      throw new AppError('allowDealerPenalty must be a boolean', 400);
    }

    const valueJson = JSON.stringify(allowed);

    await queryPostgres(
      `INSERT INTO system_settings (key, value, description, updated_at)
       VALUES ('ALLOW_DEALER_PENALTY', $1::jsonb, 'Allow dealers to add late-payment penalties to overdue EMIs', NOW())
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW()`,
      [valueJson]
    );

    await AuditService.log({
      userId: user.id,
      action: 'SYSTEM_SETTING_UPDATED',
      entity: 'SystemSetting',
      entityId: 'ALLOW_DEALER_PENALTY',
      newState: { allowDealerPenalty: allowed },
    });

    return { allowDealerPenalty: allowed };
  }
}
