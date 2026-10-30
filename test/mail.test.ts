import { describe, expect, it } from "vitest"
import { CogniCloud } from "../src/index.js"

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

const mailbox = {
  id: "7c1f0c2e-6a5b-4d3e-9f10-1a2b3c4d5e6f",
  address: "support@mail.example.com",
  localPart: "support",
  domain: "mail.example.com",
  createdAt: "2026-10-29T10:00:00Z",
  updatedAt: "2026-10-29T10:00:00Z",
}

describe("CogniCloud.mail", () => {
  it("creates a mailbox and returns its password once", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json({ mailbox, password: "Vf9!mQ2xTr7#pL4wNz8KbHd1" }, { status: 201 }),
    )
    const client = new CogniCloud({ token: "session-token", tenant: "acme", fetch })
    const created = await client.mail.create("support")
    expect(created.password).toBe("Vf9!mQ2xTr7#pL4wNz8KbHd1")
    expect(calls[0]?.url).toBe("https://cognicloud.dev/api/v1/mail/mailboxes")
    expect(calls[0]?.init.method).toBe("POST")
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ localPart: "support" })
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer session-token")
    expect(new Headers(calls[0]?.init.headers).get("tenant_id")).toBe("acme")
  })

  it("lists with paging and reads connection settings", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json({ items: [mailbox], total: 1, limit: 5, offset: 0 }),
      Response.json({
        usernameFormat: "full mailbox address",
        imap: { host: "mail.example.com", port: 993, security: "ssl" },
        smtp: { host: "mail.example.com", port: 465, security: "ssl" },
      }),
    )
    const client = new CogniCloud({ token: "t", fetch, mailBaseUrl: "https://mail.test/api/v1/mail" })
    expect((await client.mail.list({ limit: 5 })).total).toBe(1)
    expect(calls[0]?.url).toBe("https://mail.test/api/v1/mail/mailboxes?limit=5")
    expect((await client.mail.connectionSettings()).imap.port).toBe(993)
  })

  it("deletes and rotates without retrying", async () => {
    const { fetch, calls } = fakeFetch(new Response(null, { status: 204 }), Response.json({ password: "new-password-1!" }))
    const client = new CogniCloud({ token: "t", fetch })
    await client.mail.delete(mailbox.id)
    expect((await client.mail.rotatePassword(mailbox.id)).password).toBe("new-password-1!")
    expect(calls[0]?.url).toBe(`https://cognicloud.dev/api/v1/mail/mailboxes/${mailbox.id}`)
    expect(calls[1]?.url).toBe(`https://cognicloud.dev/api/v1/mail/mailboxes/${mailbox.id}/password/rotate`)
  })
})

const domain = {
  id: "d1",
  name: "yourcompany.com",
  status: "pending",
  records: [{ type: "TXT", host: "_cognicloud.yourcompany.com", value: "cognicloud-verify=abc", purpose: "ownership", ok: null }],
  otherMx: [],
  createdAt: "2026-10-30T10:00:00Z",
  verifiedAt: null,
  lastCheckedAt: null,
}

describe("CogniCloud.mail.domains", () => {
  it("adds, verifies, lists and deletes a domain, and creates a mailbox on it", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json(domain, { status: 201 }),
      Response.json({ ...domain, status: "verified" }),
      Response.json({ items: [{ ...domain, status: "verified" }] }),
      Response.json({ mailbox: { ...mailbox, address: "ceo@yourcompany.com" }, password: "pw" }, { status: 201 }),
      new Response(null, { status: 204 }),
    )
    const client = new CogniCloud({ token: "session-token", fetch })
    expect((await client.mail.domains.add("yourcompany.com")).status).toBe("pending")
    expect((await client.mail.domains.verify("d1")).status).toBe("verified")
    expect((await client.mail.domains.list()).items).toHaveLength(1)
    const created = await client.mail.create("ceo", { domain: "yourcompany.com" })
    expect(created.mailbox.address).toBe("ceo@yourcompany.com")
    await client.mail.domains.delete("d1")

    expect(calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
      "POST https://cognicloud.dev/api/v1/mail/domains",
      "POST https://cognicloud.dev/api/v1/mail/domains/d1/verify",
      "GET https://cognicloud.dev/api/v1/mail/domains",
      "POST https://cognicloud.dev/api/v1/mail/mailboxes",
      "DELETE https://cognicloud.dev/api/v1/mail/domains/d1",
    ])
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ name: "yourcompany.com" })
    expect(JSON.parse(String(calls[3]?.init.body))).toEqual({ localPart: "ceo", domain: "yourcompany.com" })
  })
})
