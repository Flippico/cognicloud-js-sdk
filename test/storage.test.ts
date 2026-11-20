import { describe, expect, it } from "vitest"
import { CogniCloud, CogniCloudError, parseKey } from "../src/index.js"
import { KEY, KEYS, PRODUCT_KEYS } from "./keys.js"

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

const base = "https://cognicloud.dev/api/v1/storage"
const bucket = { id: "b1", name: "assets", visibility: "private", description: null, objectCount: 2, totalSize: 30, createdAt: "2026-11-20T10:00:00Z" }
const object = { key: "reports/a.pdf", size: 10, etag: "\"abc\"", lastModified: "2026-11-20T10:00:00Z" }
const metadata = { ...object, contentType: "application/pdf" }
const storage = (options: { fetch: typeof fetch; maxRetries?: number }) =>
  new CogniCloud({ ...KEYS, ...options }).storage
const body = (call?: Call) => JSON.parse(String(call?.init.body))
const header = (call: Call | undefined, name: string) => new Headers(call?.init.headers).get(name)
const bytesOf = (call?: Call) => call?.init.body as Uint8Array

describe("storage keys and options", () => {
  it("reads a storage key as the storage kind", () => {
    expect(parseKey(PRODUCT_KEYS.storage).kind).toBe("storage")
  })

  it("refuses a storage getter without a storage key", () => {
    const cc = new CogniCloud({ accountKey: KEY })
    expect(() => cc.storage).toThrow(CogniCloudError)
    expect(() => cc.storage).toThrow(/productKeys\.storage/)
  })

  it("refuses another product's key as productKeys.storage", () => {
    expect(
      () => new CogniCloud({ accountKey: KEY, productKeys: { storage: PRODUCT_KEYS.database } }),
    ).toThrow(/productKeys\.storage must be a Storage key/)
  })

  it("sends the storage key as the Bearer token with the account key", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ buckets: [] }))
    await storage({ fetch }).buckets.list()
    expect(header(calls[0], "authorization")).toBe(`Bearer ${PRODUCT_KEYS.storage}`)
    expect(header(calls[0], "x-cognicloud-account-key")).toBe(KEY)
  })

  it("uses the default base URL and a storageBaseUrl override", async () => {
    const first = fakeFetch(Response.json({ buckets: [] }))
    await storage({ fetch: first.fetch }).buckets.list()
    expect(first.calls[0]?.url).toBe(`${base}/buckets`)

    const second = fakeFetch(Response.json({ buckets: [] }))
    await new CogniCloud({ ...KEYS, fetch: second.fetch, storageBaseUrl: "https://example.test/s/" }).storage.buckets.list()
    expect(second.calls[0]?.url).toBe("https://example.test/s/buckets")
  })
})

describe("storage buckets", () => {
  it("lists buckets as an array", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ buckets: [bucket] }))
    expect(await storage({ fetch }).buckets.list()).toEqual([bucket])
    expect(calls[0]?.init.method).toBe("GET")
  })

  it("creates a bucket with a description", async () => {
    const { fetch, calls } = fakeFetch(Response.json(bucket, { status: 201 }))
    expect(await storage({ fetch }).buckets.create({ name: "assets", description: "Logos" })).toEqual(bucket)
    expect(calls[0]?.init.method).toBe("POST")
    expect(body(calls[0])).toEqual({ name: "assets", description: "Logos" })
  })

  it("does not retry a create on 503, because it may have created the bucket", async () => {
    const { fetch, calls } = fakeFetch(new Response(null, { status: 503 }))
    await expect(storage({ fetch, maxRetries: 2 }).buckets.create({ name: "assets" })).rejects.toMatchObject({ status: 503 })
    expect(calls).toHaveLength(1)
  })

  it("gets a bucket by its encoded name", async () => {
    const { fetch, calls } = fakeFetch(Response.json(bucket))
    await storage({ fetch }).buckets.get("my bucket/1")
    expect(calls[0]?.url).toBe(`${base}/buckets/my%20bucket%2F1`)
  })

  it("updates visibility and clears a description with null", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ ...bucket, visibility: "public_read", description: null }))
    const updated = await storage({ fetch }).buckets.update("assets", { visibility: "public_read", description: null })
    expect(updated.visibility).toBe("public_read")
    expect(calls[0]?.init.method).toBe("PATCH")
    expect(body(calls[0])).toEqual({ visibility: "public_read", description: null })
  })

  it("deletes an empty bucket without force", async () => {
    const { fetch, calls } = fakeFetch(new Response(null, { status: 204 }))
    await expect(storage({ fetch }).buckets.delete("assets")).resolves.toBeUndefined()
    expect(calls[0]?.url).toBe(`${base}/buckets/assets`)
    expect(calls[0]?.init.method).toBe("DELETE")
  })

  it("deletes a non-empty bucket with force", async () => {
    const { fetch, calls } = fakeFetch(new Response(null, { status: 204 }))
    await storage({ fetch }).buckets.delete("assets", { force: true })
    expect(calls[0]?.url).toBe(`${base}/buckets/assets?force=true`)
  })

  it("refuses to delete a non-empty bucket with 409 and does not retry", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json({ error: "conflict", message: "The bucket is not empty." }, { status: 409 }),
    )
    const error = await storage({ fetch }).buckets.delete("assets").catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CogniCloudError)
    expect(error).toMatchObject({ status: 409, code: "conflict", message: "The bucket is not empty." })
    expect(calls).toHaveLength(1)
  })

  it("reports a missing bucket as 404", async () => {
    const { fetch } = fakeFetch(
      Response.json({ error: "not_found", message: "No bucket of yours has this name." }, { status: 404 }),
    )
    await expect(storage({ fetch }).buckets.get("nope")).rejects.toMatchObject({ status: 404, code: "not_found" })
  })
})

describe("storage object listing", () => {
  it("sends prefix, delimiter, cursor and limit as a query", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ folders: [], objects: [object], nextCursor: null }))
    const page = await storage({ fetch }).objects.list("assets", { prefix: "reports/", delimiter: "", cursor: "c1", limit: 5 })
    expect(page.objects).toEqual([object])
    expect(calls[0]?.url).toBe(`${base}/buckets/assets/objects?prefix=reports%2F&delimiter=&cursor=c1&limit=5`)
  })

  it("sends no query with no options", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ folders: ["reports/"], objects: [], nextCursor: null }))
    const page = await storage({ fetch }).objects.list("assets")
    expect(page.folders).toEqual(["reports/"])
    expect(calls[0]?.url).toBe(`${base}/buckets/assets/objects`)
  })

  it("rejects an invalid delimiter with 422", async () => {
    const { fetch } = fakeFetch(
      Response.json({ error: "validation", message: "The delimiter must be one character." }, { status: 422 }),
    )
    await expect(storage({ fetch }).objects.list("assets", { delimiter: "--" })).rejects.toMatchObject({ status: 422 })
  })

  it("walks every page with pages(), following nextCursor until it is null", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json({ folders: [], objects: [{ ...object, key: "a" }], nextCursor: "p2" }),
      Response.json({ folders: [], objects: [{ ...object, key: "b" }], nextCursor: "p3" }),
      Response.json({ folders: [], objects: [{ ...object, key: "c" }], nextCursor: null }),
    )
    const keys: string[] = []
    const pages: number[] = []
    for await (const page of storage({ fetch }).objects.pages("assets", { prefix: "x/", delimiter: "", limit: 1 })) {
      pages.push(page.objects.length)
      keys.push(...page.objects.map((item) => item.key))
    }
    expect(keys).toEqual(["a", "b", "c"])
    expect(pages).toEqual([1, 1, 1])
    expect(calls).toHaveLength(3)
    expect(calls[0]?.url).toBe(`${base}/buckets/assets/objects?prefix=x%2F&delimiter=&limit=1`)
    expect(calls[1]?.url).toBe(`${base}/buckets/assets/objects?prefix=x%2F&delimiter=&cursor=p2&limit=1`)
    expect(calls[2]?.url).toBe(`${base}/buckets/assets/objects?prefix=x%2F&delimiter=&cursor=p3&limit=1`)
  })

  it("starts pages() at the given cursor and stops when the first page has none more", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ folders: [], objects: [], nextCursor: null }))
    const pages = []
    for await (const page of storage({ fetch }).objects.pages("assets", { cursor: "resume" })) pages.push(page)
    expect(pages).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${base}/buckets/assets/objects?cursor=resume`)
  })

  it("stops fetching pages when the caller breaks out", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json({ folders: [], objects: [object], nextCursor: "p2" }),
      Response.json({ folders: [], objects: [object], nextCursor: null }),
    )
    for await (const page of storage({ fetch }).objects.pages("assets")) {
      expect(page.objects).toHaveLength(1)
      break
    }
    expect(calls).toHaveLength(1)
  })

  it("propagates a page error from pages()", async () => {
    const { fetch } = fakeFetch(
      Response.json({ folders: [], objects: [object], nextCursor: "p2" }),
      Response.json({ error: "validation", message: "Invalid cursor." }, { status: 422 }),
    )
    const seen = []
    await expect(async () => {
      for await (const page of storage({ fetch }).objects.pages("assets")) seen.push(page)
    }).rejects.toMatchObject({ status: 422, code: "validation" })
    expect(seen).toHaveLength(1)
  })
})

describe("storage objects", () => {
  it("uploads bytes with the content type, encoding each key segment", async () => {
    const { fetch, calls } = fakeFetch(Response.json(metadata))
    const data = new Uint8Array([37, 80, 68, 70])
    const stored = await storage({ fetch }).objects.upload("assets", "reports/a b+c.pdf", data, { contentType: "application/pdf" })
    expect(stored).toEqual(metadata)
    expect(calls[0]?.url).toBe(`${base}/buckets/assets/objects/reports/a%20b%2Bc.pdf`)
    expect(calls[0]?.init.method).toBe("PUT")
    expect(header(calls[0], "content-type")).toBe("application/pdf")
    expect(bytesOf(calls[0])).toEqual(data)
  })

  it("uploads an ArrayBuffer and a Blob, defaulting to application/octet-stream", async () => {
    const first = fakeFetch(Response.json(metadata))
    await storage({ fetch: first.fetch }).objects.upload("assets", "x.bin", new Uint8Array([1, 2]).buffer)
    expect(header(first.calls[0], "content-type")).toBe("application/octet-stream")

    const second = fakeFetch(Response.json(metadata))
    await storage({ fetch: second.fetch }).objects.upload("assets", "y.txt", new Blob(["hi"]), { contentType: "text/plain" })
    expect(header(second.calls[0], "content-type")).toBe("text/plain")
  })

  it("refuses an oversized upload with 422 and does not retry", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json({ error: "validation", message: "The object is too large." }, { status: 422 }),
    )
    await expect(
      storage({ fetch }).objects.upload("assets", "big.bin", new Uint8Array(1), {}),
    ).rejects.toMatchObject({ status: 422 })
    expect(calls).toHaveLength(1)
  })

  it("downloads the bytes", async () => {
    const { fetch, calls } = fakeFetch(new Response(new Uint8Array([9, 8, 7]), { status: 200 }))
    const data = await storage({ fetch }).objects.download("assets", "reports/a.pdf")
    expect(data).toBeInstanceOf(Uint8Array)
    expect([...data]).toEqual([9, 8, 7])
    expect(calls[0]?.url).toBe(`${base}/buckets/assets/objects/reports/a.pdf`)
    expect(header(calls[0], "range")).toBeNull()
    expect(header(calls[0], "accept")).toBe("*/*")
  })

  it("downloads a range with the Range header and returns the part", async () => {
    const { fetch, calls } = fakeFetch(new Response(new Uint8Array([1, 2]), { status: 206 }))
    const data = await storage({ fetch }).objects.download("assets", "a.bin", { range: "bytes=0-1" })
    expect([...data]).toEqual([1, 2])
    expect(header(calls[0], "range")).toBe("bytes=0-1")
  })

  it("retries a download on 503, because reading is safe", async () => {
    const { fetch, calls } = fakeFetch(new Response(null, { status: 503 }), new Response(new Uint8Array([5]), { status: 200 }))
    const data = await storage({ fetch, maxRetries: 1 }).objects.download("assets", "a.bin")
    expect([...data]).toEqual([5])
    expect(calls).toHaveLength(2)
  })

  it("reports a missing object as 404 from download", async () => {
    const { fetch } = fakeFetch(Response.json({ error: "not_found", message: "No such object." }, { status: 404 }))
    await expect(storage({ fetch }).objects.download("assets", "gone.bin")).rejects.toMatchObject({ status: 404, code: "not_found" })
  })

  it("reads metadata with ?metadata=true", async () => {
    const { fetch, calls } = fakeFetch(Response.json(metadata))
    expect(await storage({ fetch }).objects.metadata("assets", "reports/a.pdf")).toEqual(metadata)
    expect(calls[0]?.url).toBe(`${base}/buckets/assets/objects/reports/a.pdf?metadata=true`)
  })

  it("deletes an object and does not retry", async () => {
    const { fetch, calls } = fakeFetch(new Response(null, { status: 503 }), new Response(null, { status: 204 }))
    await expect(storage({ fetch, maxRetries: 2 }).objects.delete("assets", "a b.txt")).rejects.toMatchObject({ status: 503 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${base}/buckets/assets/objects/a%20b.txt`)
    expect(calls[0]?.init.method).toBe("DELETE")
  })

  it("deletes an object that answers 204", async () => {
    const { fetch } = fakeFetch(new Response(null, { status: 204 }))
    await expect(storage({ fetch }).objects.delete("assets", "a.txt")).resolves.toBeUndefined()
  })
})

describe("storage folders", () => {
  it("creates a folder from its prefix, where the answer is empty", async () => {
    const { fetch, calls } = fakeFetch(new Response(null, { status: 201 }))
    await expect(storage({ fetch }).folders.create("assets", "reports/2026/")).resolves.toBeUndefined()
    expect(calls[0]?.url).toBe(`${base}/buckets/assets/folders`)
    expect(calls[0]?.init.method).toBe("POST")
    expect(body(calls[0])).toEqual({ prefix: "reports/2026/" })
  })

  it("reports a missing bucket as 404", async () => {
    const { fetch } = fakeFetch(Response.json({ error: "not_found", message: "No bucket." }, { status: 404 }))
    await expect(storage({ fetch }).folders.create("nope", "x/")).rejects.toMatchObject({ status: 404 })
  })
})

describe("storage network failures", () => {
  it("reports a request that never reached the service as status 0", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed")
    }) as typeof globalThis.fetch
    await expect(storage({ fetch, maxRetries: 0 }).buckets.list()).rejects.toMatchObject({ status: 0, code: "network_error" })
  })
})

describe("storage key guard", () => {
  const badKeys = ["", "/a", "a//b", "a/./b", "a/../b", "../x", "a/..", "./a", "a\u0000b", "a\nb", "a\u007fb"]
  const badPrefixes = ["/a", "a//b", "a/./", "a/../", "../", "a\u0000"]
  const goodKeys = ["reports/", "a..b", "...", "a/b.c", "reports/a b+c.pdf"]

  const refused = (promise: Promise<unknown>) =>
    expect(promise).rejects.toMatchObject({ status: 0, code: "invalid_key" })

  it("refuses an invalid key in upload before any request", async () => {
    const { fetch, calls } = fakeFetch()
    for (const key of badKeys) await refused(storage({ fetch }).objects.upload("assets", key, new Uint8Array(1)))
    expect(calls).toHaveLength(0)
  })

  it("refuses an invalid key in download before any request", async () => {
    const { fetch, calls } = fakeFetch()
    for (const key of badKeys) await refused(storage({ fetch }).objects.download("assets", key))
    expect(calls).toHaveLength(0)
  })

  it("refuses an invalid key in metadata before any request", async () => {
    const { fetch, calls } = fakeFetch()
    for (const key of badKeys) await refused(storage({ fetch }).objects.metadata("assets", key))
    expect(calls).toHaveLength(0)
  })

  it("refuses an invalid key in delete before any request", async () => {
    const { fetch, calls } = fakeFetch()
    for (const key of badKeys) await refused(storage({ fetch }).objects.delete("assets", key))
    expect(calls).toHaveLength(0)
  })

  it("refuses an invalid folder prefix before any request", async () => {
    const { fetch, calls } = fakeFetch()
    for (const key of badKeys) await refused(storage({ fetch }).folders.create("assets", key))
    expect(calls).toHaveLength(0)
  })

  it("refuses an invalid listing prefix in list and pages before any request", async () => {
    const { fetch, calls } = fakeFetch()
    for (const prefix of badPrefixes) {
      await refused(storage({ fetch }).objects.list("assets", { prefix }))
      await refused(storage({ fetch }).objects.pages("assets", { prefix }).next())
    }
    expect(calls).toHaveLength(0)
  })

  it("accepts an empty listing prefix and valid keys, with the request sent", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json({ folders: [], objects: [], nextCursor: null }),
      ...goodKeys.map(() => new Response(new Uint8Array([1]), { status: 200 })),
    )
    await storage({ fetch }).objects.list("assets", { prefix: "" })
    for (const key of goodKeys) await storage({ fetch }).objects.download("assets", key)
    expect(calls).toHaveLength(1 + goodKeys.length)
    expect(calls[1]?.url).toBe(`${base}/buckets/assets/objects/reports/`)
  })
})
