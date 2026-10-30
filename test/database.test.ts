import { describe, expect, it } from "vitest"
import { CogniCloud, CogniCloudDatabase, CogniCloudError } from "../src/index.js"

type Call = { url: string; init: RequestInit }

function fakeFetch(...responses: Response[]) {
  const calls: Call[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    const next = responses.shift()
    if (!next) throw new Error("unexpected request")
    return next
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

const base = "https://cognicloud.dev/api/v1/database"
const result = { columns: [{ name: "id", type: "int4" }], rows: [{ id: 1 }], rowCount: 1, truncated: false }
const body = (call?: Call) => JSON.parse(String(call?.init.body))
const header = (call: Call | undefined, name: string) => new Headers(call?.init.headers).get(name)

describe("CogniCloudDatabase", () => {
  it("refuses a missing key", () => {
    expect(() => new CogniCloudDatabase({ key: " " })).toThrow(/key is required/)
  })

  it("runs SQL with the key and no tenant", async () => {
    const { fetch, calls } = fakeFetch(Response.json(result))
    const db = new CogniCloudDatabase({ key: "cgd_key", fetch })
    const found = await db.query<{ id: number }>("SELECT id FROM orders WHERE status = $1", ["paid"])
    expect(found.rows[0]?.id).toBe(1)
    expect(calls[0]?.url).toBe(`${base}/query`)
    expect(body(calls[0])).toEqual({ sql: "SELECT id FROM orders WHERE status = $1", params: ["paid"] })
    expect(header(calls[0], "authorization")).toBe("Bearer cgd_key")
    expect(header(calls[0], "tenant_id")).toBeNull()
  })

  it("does not repeat a query on a 503, because it may change data", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ error: "service_unavailable", message: "Try again." }, { status: 503 }))
    const db = new CogniCloudDatabase({ key: "cgd_key", fetch })
    await expect(db.query("DELETE FROM orders")).rejects.toMatchObject({ status: 503 })
    expect(calls).toHaveLength(1)
  })

  it("reports the Postgres code of a failed statement", async () => {
    const { fetch } = fakeFetch(
      Response.json({ code: "23505", error: "query_failed", message: "duplicate key" }, { status: 400 }),
    )
    const error = await new CogniCloudDatabase({ key: "k", fetch }).query("INSERT").catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CogniCloudError)
    expect(error).toMatchObject({ status: 400, code: "query_failed", queryCode: "23505", message: "duplicate key" })
  })

  it("sends a transaction with empty params filled in", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ results: [result, result] }))
    const results = await new CogniCloudDatabase({ key: "k", fetch }).transaction([
      { sql: "UPDATE a SET b = 1" },
      { sql: "DELETE FROM a WHERE id = $1", params: [2] },
    ])
    expect(results).toHaveLength(2)
    expect(body(calls[0])).toEqual({
      statements: [
        { sql: "UPDATE a SET b = 1", params: [] },
        { sql: "DELETE FROM a WHERE id = $1", params: [2] },
      ],
    })
  })

  it("lists tables and retries, because reading is safe", async () => {
    const tables = [{ name: "orders", columns: [{ name: "id", type: "integer", nullable: false }] }]
    const { fetch, calls } = fakeFetch(new Response(null, { status: 503 }), Response.json({ tables }))
    expect(await new CogniCloudDatabase({ key: "k", fetch, maxRetries: 1 }).tables()).toEqual(tables)
    expect(calls).toHaveLength(2)
  })

  it("builds a select with every filter and sends it when awaited", async () => {
    const { fetch, calls } = fakeFetch(Response.json(result))
    const query = new CogniCloudDatabase({ key: "k", fetch })
      .table("order items")
      .select("id", "email")
      .eq("a", 1)
      .neq("b", 2)
      .gt("c", 3)
      .gte("d", 4)
      .lt("e", 5)
      .lte("f", 6)
      .like("g", "%x")
      .ilike("h", "%y")
      .is("i", null)
      .in("j", [1, 2])
      .order("id", { desc: true })
      .order("email")
      .limit(10)
      .offset(20)
    expect(calls).toHaveLength(0)
    await query
    await query
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${base}/tables/order%20items/select`)
    expect(body(calls[0])).toEqual({
      columns: ["id", "email"],
      filters: [
        { column: "a", op: "eq", value: 1 },
        { column: "b", op: "neq", value: 2 },
        { column: "c", op: "gt", value: 3 },
        { column: "d", op: "gte", value: 4 },
        { column: "e", op: "lt", value: 5 },
        { column: "f", op: "lte", value: 6 },
        { column: "g", op: "like", value: "%x" },
        { column: "h", op: "ilike", value: "%y" },
        { column: "i", op: "is", value: null },
        { column: "j", op: "in", value: [1, 2] },
      ],
      order: [
        { column: "id", desc: true },
        { column: "email", desc: false },
      ],
      limit: 10,
      offset: 20,
    })
  })

  it("selects every column by default", async () => {
    const { fetch, calls } = fakeFetch(Response.json(result))
    await new CogniCloudDatabase({ key: "k", fetch }).table("orders").select()
    expect(body(calls[0])).toEqual({ columns: [], filters: [], order: [] })
  })

  it("inserts one row or many at once", async () => {
    const { fetch, calls } = fakeFetch(Response.json(result), Response.json(result))
    const orders = new CogniCloudDatabase({ key: "k", fetch }).table("orders")
    await orders.insert({ email: "a" })
    await orders.insert([{ email: "b" }, { email: "c" }])
    expect(body(calls[0])).toEqual({ rows: [{ email: "a" }] })
    expect(body(calls[1])).toEqual({ rows: [{ email: "b" }, { email: "c" }] })
  })

  it("updates and deletes with filters, without retrying", async () => {
    const { fetch, calls } = fakeFetch(Response.json(result), Response.json({ error: "x", message: "y" }, { status: 503 }))
    const orders = new CogniCloudDatabase({ key: "k", fetch }).table("orders")
    await orders.update({ total: 5 }).eq("id", 1)
    await expect(orders.delete().eq("id", 1)).rejects.toMatchObject({ status: 503 })
    expect(calls[0]?.url).toBe(`${base}/tables/orders/update`)
    expect(body(calls[0])).toEqual({ values: { total: 5 }, filters: [{ column: "id", op: "eq", value: 1 }] })
    expect(calls[1]?.url).toBe(`${base}/tables/orders/delete`)
    expect(calls).toHaveLength(2)
  })
})

describe("CogniCloud.database", () => {
  const database = { id: "db1", name: "Orders", createdAt: "2026-10-30T10:00:00Z" }

  it("manages databases as the signed-in person", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json(database, { status: 201 }),
      Response.json({ items: [database] }),
      Response.json(database),
      new Response(null, { status: 204 }),
    )
    const cc = new CogniCloud({ token: "session", tenant: "acme", fetch, databaseBaseUrl: "https://db.test/v1/" })
    expect((await cc.database.create("Orders")).id).toBe("db1")
    expect(await cc.database.list()).toEqual([database])
    expect((await cc.database.get("db1")).name).toBe("Orders")
    await cc.database.delete("db1")
    expect(calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
      "POST https://db.test/v1/databases",
      "GET https://db.test/v1/databases",
      "GET https://db.test/v1/databases/db1",
      "DELETE https://db.test/v1/databases/db1",
    ])
    expect(body(calls[0])).toEqual({ name: "Orders" })
    expect(header(calls[0], "authorization")).toBe("Bearer session")
    expect(header(calls[0], "tenant_id")).toBe("acme")
  })

  it("lists and revokes keys and pages through actions", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json([]),
      new Response(null, { status: 204 }),
      Response.json({ items: [], nextCursor: null }),
    )
    const cc = new CogniCloud({ token: "t", fetch })
    await cc.database.keys.list("db1")
    await cc.database.keys.revoke("db1", "key1")
    await cc.database.actions({ limit: 5, cursor: "abc" })
    expect(calls[0]?.url).toBe(`${base}/databases/db1/keys`)
    expect(calls[1]?.url).toBe(`${base}/databases/db1/keys/key1`)
    expect(calls[1]?.init.method).toBe("DELETE")
    expect(calls[2]?.url).toBe(`${base}/actions?limit=5&cursor=abc`)
  })
})
