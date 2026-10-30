import { send, type HttpConfig } from "./http.js"
import type {
  CreatedMailbox,
  CreateMailboxOptions,
  Mailbox,
  MailboxList,
  MailboxListOptions,
  MailConnectionSettings,
  MailDomain,
  MailDomainList,
  RotatedMailboxPassword,
} from "./types.js"

/**
 * Your own domains for mailboxes. Adding, verifying and deleting need a signed-in person's token; an API key can
 * list them and create mailboxes on verified ones.
 */
export class MailDomainsApi {
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>

  constructor(config: HttpConfig, headers: Record<string, string>) {
    this.config = config
    this.headers = headers
  }

  /** Newest first, each with the DNS records to publish. */
  list(): Promise<MailDomainList> {
    return send(this.config, { method: "GET", path: "/domains", headers: this.headers })
  }

  get(id: string): Promise<MailDomain> {
    return send(this.config, { method: "GET", path: `/domains/${encodeURIComponent(id)}`, headers: this.headers })
  }

  /** Adds the domain as pending. Publish its `records`, then call `verify`. */
  add(name: string): Promise<MailDomain> {
    return send(this.config, { method: "POST", path: "/domains", headers: this.headers, body: { name }, retry: false })
  }

  /** Checks the domain's DNS now. The first time the ownership record is found, the domain becomes verified. */
  verify(id: string): Promise<MailDomain> {
    return send(this.config, {
      method: "POST",
      path: `/domains/${encodeURIComponent(id)}/verify`,
      headers: this.headers,
      retry: false,
    })
  }

  /** Refused while the domain has mailboxes. */
  delete(id: string): Promise<void> {
    return send(this.config, {
      method: "DELETE",
      path: `/domains/${encodeURIComponent(id)}`,
      headers: this.headers,
      retry: false,
    })
  }
}

/** Creates, lists and removes mailboxes on the Flippico mail server. */
export class MailApi {
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>
  readonly domains: MailDomainsApi

  constructor(config: HttpConfig, headers: Record<string, string>) {
    this.config = config
    this.headers = headers
    this.domains = new MailDomainsApi(config, headers)
  }

  /** Newest first. */
  list(options: MailboxListOptions = {}): Promise<MailboxList> {
    const query = new URLSearchParams()
    if (options.limit !== undefined) query.set("limit", String(options.limit))
    if (options.offset !== undefined) query.set("offset", String(options.offset))
    const suffix = query.size > 0 ? `?${query.toString()}` : ""
    return send(this.config, { method: "GET", path: `/mailboxes${suffix}`, headers: this.headers })
  }

  /**
   * Creates `<localPart>@<domain>` on the mail server: on the shared domain, or on one of your verified domains with
   * `domain`. The password in the result is returned once and is not stored, so save it now. Names are 1 to 64
   * characters: letters, digits, dots, dashes and underscores.
   */
  create(localPart: string, options: CreateMailboxOptions = {}): Promise<CreatedMailbox> {
    return send(this.config, {
      method: "POST",
      path: "/mailboxes",
      headers: this.headers,
      body: options.domain === undefined ? { localPart } : { localPart, domain: options.domain },
      retry: false,
    })
  }

  get(id: string): Promise<Mailbox> {
    return send(this.config, { method: "GET", path: `/mailboxes/${encodeURIComponent(id)}`, headers: this.headers })
  }

  /** Deletes the mailbox and its mail on the server. */
  delete(id: string): Promise<void> {
    return send(this.config, {
      method: "DELETE",
      path: `/mailboxes/${encodeURIComponent(id)}`,
      headers: this.headers,
      retry: false,
    })
  }

  /** Replaces the password on the server and returns the new one once. The old password stops working. */
  rotatePassword(id: string): Promise<RotatedMailboxPassword> {
    return send(this.config, {
      method: "POST",
      path: `/mailboxes/${encodeURIComponent(id)}/password/rotate`,
      headers: this.headers,
      retry: false,
    })
  }

  /** Where mail clients connect with IMAP and SMTP. Sign in with the full address and its password. */
  connectionSettings(): Promise<MailConnectionSettings> {
    return send(this.config, { method: "GET", path: "/mailboxes/settings", headers: this.headers })
  }
}
