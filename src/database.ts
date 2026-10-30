import { send, type HttpConfig } from "./http.js"
import type {
  DatabaseActionList,
  DatabaseActionListOptions,
  DatabaseFilter,
  DatabaseKey,
  DatabaseList,
  DatabaseOrder,
  DatabaseRow,
  DatabaseSelect,
  DatabaseStatement,
  DatabaseTable,
  HostedDatabase,
  QueryResult,
} from "./types.js"

type Run<T> = (filters: DatabaseFilter[]) => Promise<QueryResult<T>>

/** Collects filters and sends the request when awaited. Awaiting it twice sends it once. */
class FilteredQuery<T> implements PromiseLike<QueryResult<T>> {
  private readonly run: Run<T>
  private readonly filters: DatabaseFilter[] = []
  private result?: Promise<QueryResult<T>>

  constructor(run: Run<T>) {
    this.run = run
  }

  private add(column: string, op: string, value: unknown): this {
    this.filters.push({ column, op, value })
    return this
  }

  eq(column: string, value: unknown): this {
    return this.add(column, "eq", value)
  }

  neq(column: string, value: unknown): this {
    return this.add(column, "neq", value)
  }

  gt(column: string, value: unknown): this {
    return this.add(column, "gt", value)
  }

  gte(column: string, value: unknown): this {
    return this.add(column, "gte", value)
  }

  lt(column: string, value: unknown): this {
    return this.add(column, "lt", value)
  }

  lte(column: string, value: unknown): this {
    return this.add(column, "lte", value)
  }

  like(column: string, pattern: string): this {
    return this.add(column, "like", pattern)
  }

  ilike(column: string, pattern: string): this {
    return this.add(column, "ilike", pattern)
  }

  /** Compares with `null`, `true` or `false`. */
  is(column: string, value: boolean | null): this {
    return this.add(column, "is", value)
  }

  in(column: string, values: unknown[]): this {
    return this.add(column, "in", values)
  }

  then<A = QueryResult<T>, B = never>(
    fulfilled?: ((value: QueryResult<T>) => A | PromiseLike<A>) | null,
    rejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    this.result ??= this.run(this.filters)
    return this.result.then(fulfilled, rejected)
  }
}

/** A select. Without `limit` it returns up to 1,000 rows, the most one response can hold. */
export class DatabaseSelectQuery<T> extends FilteredQuery<T> {
  private readonly select: DatabaseSelect

  constructor(select: DatabaseSelect, run: (select: DatabaseSelect) => Promise<QueryResult<T>>) {
    super((filters) => run({ ...select, filters }))
    this.select = select
  }

  order(column: string, options: { desc?: boolean } = {}): this {
    this.select.order.push({ column, desc: options.desc ?? false } satisfies DatabaseOrder)
    return this
  }

  limit(limit: number): this {
    this.select.limit = limit
    return this
  }

  offset(offset: number): this {
    this.select.offset = offset
    return this
  }
}

/** One table in the `public` schema. Table and column names are checked against the database. */
export class DatabaseTableApi<T extends DatabaseRow = DatabaseRow> {
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>
  private readonly path: string

  constructor(config: HttpConfig, headers: Record<string, string>, table: string) {
    this.config = config
    this.headers = headers
    this.path = `/tables/${encodeURIComponent(table)}`
  }

  private post<R>(verb: string, body: unknown, retry: boolean): Promise<QueryResult<R>> {
    return send(this.config, { method: "POST", path: `${this.path}/${verb}`, headers: this.headers, body, retry })
  }

  /** The named columns, or every column with none. */
  select(...columns: string[]): DatabaseSelectQuery<T> {
    return new DatabaseSelectQuery<T>({ columns, filters: [], order: [] }, (select) => this.post("select", select, true))
  }

  /** Inserts now and returns the new rows. A column a row leaves out takes its default. Needs a write key. */
  insert(rows: Partial<T> | Partial<T>[]): Promise<QueryResult<T>> {
    return this.post("insert", { rows: Array.isArray(rows) ? rows : [rows] }, false)
  }

  /** Changes the rows the filters match and returns them. At least one filter is required. Needs a write key. */
  update(values: Partial<T>): FilteredQuery<T> {
    return new FilteredQuery<T>((filters) => this.post("update", { values, filters }, false))
  }

  /** Deletes the rows the filters match and returns them. At least one filter is required. Needs a write key. */
  delete(): FilteredQuery<T> {
    return new FilteredQuery<T>((filters) => this.post("delete", { filters }, false))
  }
}

/** Queries one database with its key. */
export class DatabaseDataApi {
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>

  constructor(config: HttpConfig, key: string) {
    this.config = config
    this.headers = { authorization: `Bearer ${key}` }
  }

  /**
   * Runs one SQL statement, with `$1`, `$2` for `params`. It stops after 15 seconds and returns at most 1,000 rows and
   * 5 MB; `truncated` says when more matched. Never retried, because it may change data.
   */
  query<T extends DatabaseRow = DatabaseRow>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return send(this.config, { method: "POST", path: "/query", headers: this.headers, body: { sql, params }, retry: false })
  }

  /** Runs 1 to 20 statements that commit together, or none do. Needs a write key. Never retried. */
  async transaction(statements: DatabaseStatement[]): Promise<QueryResult[]> {
    const body = await send<{ results: QueryResult[] }>(this.config, {
      method: "POST",
      path: "/transaction",
      headers: this.headers,
      body: { statements: statements.map(({ sql, params }) => ({ sql, params: params ?? [] })) },
      retry: false,
    })
    return body.results
  }

  /** Tables and views in the `public` schema that this key can read. */
  async tables(): Promise<DatabaseTable[]> {
    const body = await send<{ tables: DatabaseTable[] }>(this.config, { method: "GET", path: "/tables", headers: this.headers })
    return body.tables
  }

  table<T extends DatabaseRow = DatabaseRow>(name: string): DatabaseTableApi<T> {
    return new DatabaseTableApi<T>(this.config, this.headers, name)
  }
}

/** A database's keys. Keys are created in the dashboard and shown there once. */
export class DatabaseKeysApi {
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>

  constructor(config: HttpConfig, headers: Record<string, string>) {
    this.config = config
    this.headers = headers
  }

  /** Active keys, newest first. */
  list(databaseId: string): Promise<DatabaseKey[]> {
    return send(this.config, { method: "GET", path: `/databases/${encodeURIComponent(databaseId)}/keys`, headers: this.headers })
  }

  /** The key stops working on its next request. */
  revoke(databaseId: string, keyId: string): Promise<void> {
    return send(this.config, {
      method: "DELETE",
      path: `/databases/${encodeURIComponent(databaseId)}/keys/${encodeURIComponent(keyId)}`,
      headers: this.headers,
      retry: false,
    })
  }
}

/** Creates and removes hosted Postgres databases. Needs a signed-in person's token; a key is refused. */
export class DatabaseApi {
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>
  readonly keys: DatabaseKeysApi

  constructor(config: HttpConfig, headers: Record<string, string>) {
    this.config = config
    this.headers = headers
    this.keys = new DatabaseKeysApi(config, headers)
  }

  /** Newest first. */
  async list(): Promise<HostedDatabase[]> {
    const body = await send<DatabaseList>(this.config, { method: "GET", path: "/databases", headers: this.headers })
    return body.items
  }

  get(id: string): Promise<HostedDatabase> {
    return send(this.config, { method: "GET", path: `/databases/${encodeURIComponent(id)}`, headers: this.headers })
  }

  /** Creates an empty database. You can have up to 3. */
  create(name: string): Promise<HostedDatabase> {
    return send(this.config, { method: "POST", path: "/databases", headers: this.headers, body: { name }, retry: false })
  }

  /** Deletes the database, all its data and its keys. This cannot be undone. */
  delete(id: string): Promise<void> {
    return send(this.config, {
      method: "DELETE",
      path: `/databases/${encodeURIComponent(id)}`,
      headers: this.headers,
      retry: false,
    })
  }

  /** Creating and deleting databases and keys, newest first. Queries are not listed. */
  actions(options: DatabaseActionListOptions = {}): Promise<DatabaseActionList> {
    const query = new URLSearchParams()
    if (options.limit !== undefined) query.set("limit", String(options.limit))
    if (options.cursor !== undefined) query.set("cursor", options.cursor)
    const suffix = query.size > 0 ? `?${query.toString()}` : ""
    return send(this.config, { method: "GET", path: `/actions${suffix}`, headers: this.headers })
  }
}
