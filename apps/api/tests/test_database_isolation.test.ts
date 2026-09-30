import {
  getEffectiveDatabaseConfig,
  extractDatabaseName,
  getPostgresPool,
  closePostgresPool,
  queryPostgres,
} from '../src/database/postgres';

describe('PostgreSQL Test-Database Isolation & Safety Guard Tests', () => {
  afterAll(async () => {
    await closePostgresPool();
  });

  describe('extractDatabaseName utility', () => {
    test('extracts database name from standard postgres URLs', () => {
      expect(extractDatabaseName('postgresql://postgres:pass@localhost:5432/crm_db')).toBe('crm_db');
      expect(extractDatabaseName('postgresql://postgres:pass@localhost:5432/crm_test_db')).toBe('crm_test_db');
      expect(
        extractDatabaseName('postgres://user:secret@db.internal:5432/crm_finance_test?sslmode=require')
      ).toBe('crm_finance_test');
    });

    test('returns null for empty or invalid strings', () => {
      expect(extractDatabaseName('')).toBeNull();
      expect(extractDatabaseName(undefined)).toBeNull();
    });
  });

  describe('Safety Guard & Database Selection Matrix', () => {
    const devDbUrl = 'postgresql://postgres:postgres_secure_pass_2026@localhost:5432/crm_db';
    const testDbUrl = 'postgresql://postgres:postgres_secure_pass_2026@localhost:5432/crm_test_db';

    // Requirement 9.A: NODE_ENV=test + DATABASE_URL_TEST configured -> test connection uses DATABASE_URL_TEST
    test('Requirement 9.A: NODE_ENV=test + DATABASE_URL_TEST configured selects test DB', () => {
      const config = getEffectiveDatabaseConfig({
        nodeEnv: 'test',
        databaseUrl: devDbUrl,
        databaseUrlTest: testDbUrl,
      });

      expect(config.isTest).toBe(true);
      expect(config.connectionString).toBe(testDbUrl);
      expect(config.databaseName).toBe('crm_test_db');
    });

    // Requirement 9.B: NODE_ENV=test + DATABASE_URL_TEST missing -> application/test setup fails clearly
    test('Requirement 9.B: NODE_ENV=test + DATABASE_URL_TEST missing throws fatal safety guard error', () => {
      expect(() => {
        getEffectiveDatabaseConfig({
          nodeEnv: 'test',
          databaseUrl: devDbUrl,
          databaseUrlTest: '',
        });
      }).toThrow(/FATAL TEST DB SAFETY GUARD.*DATABASE_URL_TEST is missing/);

      expect(() => {
        getEffectiveDatabaseConfig({
          nodeEnv: 'test',
          databaseUrl: devDbUrl,
          databaseUrlTest: undefined,
        });
      }).toThrow(/FATAL TEST DB SAFETY GUARD.*DATABASE_URL_TEST is missing/);
    });

    // Requirement 9.C: DATABASE_URL_TEST points to normal crm_db -> fail-safe rejection
    test('Requirement 9.C: DATABASE_URL_TEST points to normal crm_db triggers fail-safe rejection', () => {
      // Direct crm_db name match
      expect(() => {
        getEffectiveDatabaseConfig({
          nodeEnv: 'test',
          databaseUrl: devDbUrl,
          databaseUrlTest: 'postgresql://postgres:postgres_secure_pass_2026@localhost:5432/crm_db',
        });
      }).toThrow(/FATAL TEST DB SAFETY GUARD.*points directly to the normal development database \("crm_db"\)/);

      // Identical to DATABASE_URL
      expect(() => {
        getEffectiveDatabaseConfig({
          nodeEnv: 'test',
          databaseUrl: 'postgresql://other_user:pass@localhost:5432/some_db',
          databaseUrlTest: 'postgresql://other_user:pass@localhost:5432/some_db',
        });
      }).toThrow(/FATAL TEST DB SAFETY GUARD.*identical to normal DATABASE_URL/);

      // Non-test DB name without 'test' keyword
      expect(() => {
        getEffectiveDatabaseConfig({
          nodeEnv: 'test',
          databaseUrl: devDbUrl,
          databaseUrlTest: 'postgresql://postgres:pass@localhost:5432/crm_production_data',
        });
      }).toThrow(/FATAL TEST DB SAFETY GUARD.*not clearly identified as a test database/);
    });

    // Requirement 9.D: Normal development mode -> continues using DATABASE_URL normally
    test('Requirement 9.D: Normal development mode continues using DATABASE_URL normally', () => {
      const config = getEffectiveDatabaseConfig({
        nodeEnv: 'development',
        databaseUrl: devDbUrl,
        databaseUrlTest: testDbUrl,
      });

      expect(config.isTest).toBe(false);
      expect(config.connectionString).toBe(devDbUrl);
      expect(config.databaseName).toBe('crm_db');
    });

    // Requirement 10: Production safety -> strictly uses DATABASE_URL and never DATABASE_URL_TEST
    test('Requirement 10: Production mode strictly uses DATABASE_URL and ignores DATABASE_URL_TEST', () => {
      const prodUrl = 'postgresql://prod_user:secret@rds.ap-south-1.internal:5432/crm_production_db';
      const config = getEffectiveDatabaseConfig({
        nodeEnv: 'production',
        databaseUrl: prodUrl,
        databaseUrlTest: testDbUrl,
      });

      expect(config.isTest).toBe(false);
      expect(config.connectionString).toBe(prodUrl);
      expect(config.databaseName).toBe('crm_production_db');
      expect(config.connectionString).not.toBe(testDbUrl);
    });
  });

  describe('Live PostgreSQL Isolation Verification', () => {
    test('Active pool query strictly connects to crm_test_db and NEVER crm_db in test mode', async () => {
      expect(process.env.NODE_ENV).toBe('test');

      const result = await queryPostgres<{ current_database: string }>('SELECT current_database();');
      expect(result.rows.length).toBe(1);

      const activeDb = result.rows[0].current_database;
      expect(activeDb).toBe('crm_test_db');
      expect(activeDb).not.toBe('crm_db');
    });
  });
});
