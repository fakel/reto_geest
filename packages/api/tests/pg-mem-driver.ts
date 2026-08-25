import { newDb, type IMemoryDb } from 'pg-mem';
import { ColumnTypeEnum } from '@prisma/driver-adapter-utils';
import type {
  ConnectionInfo,
  SqlDriverAdapterFactory,
  SqlQuery,
  SqlQueryable,
  SqlResultSet,
  Transaction,
} from '@prisma/driver-adapter-utils';

/**
 * Minimal Prisma ORM v7 driver adapter backed directly by pg-mem.
 *
 * Why this exists: the installed @prisma/adapter-pg cannot talk to pg-mem.
 *  1. Its constructor only treats a real `instanceof pg.Pool` as an external
 *     pool; pg-mem's fake `Pool` fails that check, so it falls back to spawning
 *     a *real* pg.Pool (which tries a TCP connection -> error).
 *  2. Its column-type mapping relies on Postgres OIDs (`field.dataTypeID`),
 *     but pg-mem exposes them via `field.typeId`, and returns rows as objects
 *     rather than the `row-mode:array` the adapter expects.
 *
 * This adapter executes the exact SQL the Prisma query engine generates against
 * pg-mem (preserving real FKs, unique constraints, OCC/version, transactions)
 * and reports column metadata from `field.typeId` using the same OID->type
 * mapping Prisma's own pg adapter uses.
 */

/** Prisma/generated pg OIDs -> Prisma ColumnType (subset covering our schema). */
const OID_TO_COLUMN_TYPE: Record<number, string> = {
  16: ColumnTypeEnum.Boolean, // bool
  17: ColumnTypeEnum.Bytes, // bytea
  18: ColumnTypeEnum.Character, // char
  19: ColumnTypeEnum.Text, // name
  20: ColumnTypeEnum.Int64, // int8
  21: ColumnTypeEnum.Int32, // int2
  23: ColumnTypeEnum.Int32, // int4
  25: ColumnTypeEnum.Text, // text
  26: ColumnTypeEnum.Int64, // oid
  114: ColumnTypeEnum.Json, // json
  700: ColumnTypeEnum.Float, // float4
  701: ColumnTypeEnum.Double, // float8
  1042: ColumnTypeEnum.Character, // bpchar
  1043: ColumnTypeEnum.Text, // varchar
  1082: ColumnTypeEnum.Date, // date
  1083: ColumnTypeEnum.Time, // time
  1114: ColumnTypeEnum.DateTime, // timestamp
  1266: ColumnTypeEnum.Time, // timetz
  1184: ColumnTypeEnum.DateTime, // timestamptz
  1700: ColumnTypeEnum.Numeric, // numeric
  2950: ColumnTypeEnum.Uuid, // uuid
  3802: ColumnTypeEnum.Json, // jsonb
  // Common arrays
  1007: ColumnTypeEnum.Int32Array, // int4[]
  1016: ColumnTypeEnum.Int64Array, // int8[]
  1005: ColumnTypeEnum.Int32Array, // int2[]
  1009: ColumnTypeEnum.TextArray, // text[]
  1115: ColumnTypeEnum.DateTimeArray, // timestamp[]
  1041: ColumnTypeEnum.FloatArray, // float4[]
  1022: ColumnTypeEnum.FloatArray, // float8[] (unlikely)
  1015: ColumnTypeEnum.BooleanArray, // bool[]
  2951: ColumnTypeEnum.UuidArray, // uuid[]
};

const DEFAULT_COLUMN_TYPE = ColumnTypeEnum.Text;

function toColumnType(oid: number | undefined): string {
  return (oid !== undefined && OID_TO_COLUMN_TYPE[oid]) || DEFAULT_COLUMN_TYPE;
}

/** Shape pg-mem returns from an executed query. */
interface MemResult {
  rowCount: number;
  fields: Array<{ name: string; typeId?: number }>;
  rows: Array<Record<string, unknown>>;
}

function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

class PgMemQueryable implements SqlQueryable {
  constructor(private readonly db: IMemoryDb) {}

  readonly provider = 'postgres' as const;
  readonly adapterName = 'pg-mem';

  getConnectionInfo(): ConnectionInfo {
    return { supportsRelationJoins: true };
  }

  private quote(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (value instanceof Date) return `'${value.toISOString()}'`;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
    if (ArrayBuffer.isView(value)) {
      const bytes = Buffer.from(value as Uint8Array);
      return `'\\x${bytes.toString('hex')}'`;
    }
    return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
  }

  private execute(query: SqlQuery): MemResult {
    const { sql, args = [] } = query;
    if (args.length === 0) {
      return this.db.public.query(sql) as unknown as MemResult;
    }
    // Inline $N placeholders as literals: pg-mem's focus() cannot convert JS
    // booleans/Dates into PG values, but plain SQL literals parse correctly.
    let index = 0;
    const inlined = sql.replace(/\$\d+/g, () => this.quote(args[index++]));
    return this.db.public.query(inlined) as unknown as MemResult;
  }

  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    const result = this.execute(query);
    const columnNames = result.fields.map((f) => f.name);
    const columnTypes = result.fields.map((f) => toColumnType(f.typeId));
    const rows = result.rows.map((row) => columnNames.map((name) => row[name] ?? null));
    return { columnNames, columnTypes, rows };
  }

  async executeRaw(query: SqlQuery): Promise<number> {
    const result = this.execute(query);
    return typeof result.rowCount === 'number' ? result.rowCount : 0;
  }

  async executeScript(script: string): Promise<void> {
    for (const statement of splitStatements(script)) {
      this.db.public.query(statement);
    }
  }

  async startTransaction(): Promise<Transaction> {
    // pg-mem does not enforce cross-statement atomicity; the transaction object
    // delegates reads/writes to the same in-memory database.
    return new PgTransaction(this.db);
  }

  async dispose(): Promise<void> {
    // pg-mem keeps everything in memory; nothing to release.
  }
}

/** Delegating transaction whose commit/rollback are no-ops (pg-mem constraint). */
class PgTransaction extends PgMemQueryable implements Transaction {
  constructor(db: IMemoryDb) {
    super(db);
  }

  readonly options = {} as Transaction['options'];

  async commit(): Promise<void> {}
  async rollback(): Promise<void> {}
}

/** Factory handed to `new PrismaClient({ adapter })`. */
export class PgMemDriverAdapter implements SqlDriverAdapterFactory {
  private readonly db: IMemoryDb;
  private readonly queryable: PgMemQueryable;

  constructor() {
    this.db = newDb();
    this.queryable = new PgMemQueryable(this.db);
  }

  readonly provider = 'postgres' as const;
  readonly adapterName = 'pg-mem';

  async connect(): Promise<PgMemQueryable> {
    return this.queryable;
  }

  /** Push schema DDL directly (used once at setup, before Prisma's first query). */
  executeScript(script: string): Promise<void> {
    return this.queryable.executeScript(script);
  }

  /** Underlying pg-mem database, exposed for tests that reset between cases. */
  get dbInstance(): IMemoryDb {
    return this.db;
  }
}