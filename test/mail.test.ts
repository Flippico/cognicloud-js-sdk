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
