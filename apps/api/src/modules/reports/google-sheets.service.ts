import crypto from 'crypto';
import { env } from '../../config/env';
import { BadRequestError } from '../../middlewares/error.middleware';

export interface ISheetExportPayload {
  sheetTitle: string;
  headers: string[];
  rows: (string | number | boolean | null | undefined)[][];
}

export interface ISheetExportResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
  sheetTitle: string;
  updatedRows: number;
  updatedColumns: number;
  exportedAt: string;
}

export interface IGoogleSheetsProvider {
  syncToSheet(payload: ISheetExportPayload): Promise<ISheetExportResult>;
}

export class GoogleSheetsService {
  private static mockProvider: IGoogleSheetsProvider | null = null;

  /**
   * For integration testing: override the Google Sheets provider
   */
  public static setMockProvider(provider: IGoogleSheetsProvider | null): void {
    this.mockProvider = provider;
  }

  /**
   * Check if Google Sheets integration is enabled and fully configured
   */
  public static isConfigured(): boolean {
    if (this.mockProvider) return true;
    const isEnabled = env.GOOGLE_SHEETS_ENABLED === 'true' || process.env.GOOGLE_SHEETS_ENABLED === 'true';
    const hasSpreadsheetId = !!(env.GOOGLE_SHEETS_SPREADSHEET_ID || process.env.GOOGLE_SHEETS_SPREADSHEET_ID);
    const hasEmail = !!(env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
    const hasKey = !!(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
    return isEnabled && hasSpreadsheetId && hasEmail && hasKey;
  }

  /**
   * Sanitize value for Google Sheets cell to prevent CSV/Sheet Formula Injection (CWE-1236)
   */
  public static sanitizeCellValue(val: unknown): string | number | boolean {
    if (val === null || val === undefined) return '';
    if (typeof val === 'number') return Number.isFinite(val) ? val : String(val);
    if (typeof val === 'boolean') return val;

    let str = String(val).trim();
    // Neutralize formula injection triggers
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }
    return str;
  }

  /**
   * Generate an OAuth2 Access Token for Google APIs using Service Account JWT
   */
  private static async getAccessToken(clientEmail: string, rawPrivateKey: string): Promise<string> {
    const formattedKey = rawPrivateKey.replace(/\\n/g, '\n');
    const now = Math.floor(Date.now() / 1000);
    const header = {
      alg: 'RS256',
      typ: 'JWT',
    };
    const claimSet = {
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedClaimSet = Buffer.from(JSON.stringify(claimSet)).toString('base64url');
    const signatureInput = `${encodedHeader}.${encodedClaimSet}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signatureInput);
    const signature = signer.sign(formattedKey, 'base64url');

    const jwt = `${signatureInput}.${signature}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`Google OAuth2 authentication failed: ${errText}`);
    }

    const tokenData = (await tokenRes.json()) as { access_token: string };
    return tokenData.access_token;
  }

  /**
   * Export report data directly to a Google Sheets worksheet tab
   */
  public static async exportReport(payload: ISheetExportPayload): Promise<ISheetExportResult> {
    if (this.mockProvider) {
      return this.mockProvider.syncToSheet(payload);
    }

    const isEnabled = env.GOOGLE_SHEETS_ENABLED === 'true' || process.env.GOOGLE_SHEETS_ENABLED === 'true';
    const spreadsheetId = env.GOOGLE_SHEETS_SPREADSHEET_ID || process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    const clientEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

    if (!isEnabled || !spreadsheetId || !clientEmail || !privateKey) {
      throw new BadRequestError(
        'Google Sheets export is not configured. Please configure GOOGLE_SHEETS_ENABLED, GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in your environment variables.'
      );
    }

    try {
      const accessToken = await this.getAccessToken(clientEmail, privateKey);
      const sheetTitle = payload.sheetTitle || 'CRM Report';

      // 1. Fetch metadata to check if the worksheet tab exists
      const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!metaRes.ok) {
        const errText = await metaRes.text();
        throw new Error(`Failed to access Google Spreadsheet (${spreadsheetId}): ${errText}`);
      }

      const meta = (await metaRes.json()) as { sheets?: Array<{ properties?: { title?: string } }> };
      const sheetsList = meta.sheets || [];
      const tabExists = sheetsList.some((s) => s.properties?.title === sheetTitle);

      // 2. If tab doesn't exist, create it
      if (!tabExists) {
        const addSheetRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requests: [
                {
                  addSheet: {
                    properties: {
                      title: sheetTitle,
                      gridProperties: {
                        rowCount: Math.max(100, payload.rows.length + 10),
                        columnCount: Math.max(20, payload.headers.length + 5),
                      },
                    },
                  },
                },
              ],
            }),
          }
        );

        if (!addSheetRes.ok) {
          const errText = await addSheetRes.text();
          console.warn(`[GoogleSheetsService] Could not create tab '${sheetTitle}', continuing:`, errText);
        }
      }

      // 3. Clear existing values in the sheet tab
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetTitle)}:clear`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      ).catch(() => {});

      // 4. Sanitize and prepare matrix
      const sanitizedHeaders = payload.headers.map((h) => this.sanitizeCellValue(h));
      const sanitizedRows = payload.rows.map((row) =>
        row.map((cell) => this.sanitizeCellValue(cell))
      );
      const valuesMatrix = [sanitizedHeaders, ...sanitizedRows];

      // 5. Write data starting at cell A1
      const updateRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
          sheetTitle
        )}!A1?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            range: `${sheetTitle}!A1`,
            majorDimension: 'ROWS',
            values: valuesMatrix,
          }),
        }
      );

      if (!updateRes.ok) {
        const errText = await updateRes.text();
        throw new Error(`Failed to write values to Google Sheet '${sheetTitle}': ${errText}`);
      }

      return {
        spreadsheetId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
        sheetTitle,
        updatedRows: payload.rows.length,
        updatedColumns: payload.headers.length,
        exportedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      if (err instanceof BadRequestError) throw err;
      throw new BadRequestError(`Google Sheets export error: ${err.message || 'Operation failed'}`);
    }
  }
}
