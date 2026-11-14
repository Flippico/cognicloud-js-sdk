import { CogniCloudError } from "./errors.js"

/** What a key reaches: the whole workspace, or one product. */
export type KeyKind = "account" | "gateway" | "database" | "browser" | "mail" | "agents" | "vault"

const prefixes: Record<string, KeyKind> = {
  cc_acc_: "account",
  cc_gw_: "gateway",
  cc_db_: "database",
  cc_br_: "browser",
  cc_ml_: "mail",
  cc_ag_: "agents",
  cc_vt_: "vault",
}

const retired = ["cc_live_", "ccag_", "cga_", "cgb_", "cgd_", "cgm_", "cgv_"]

const settings = "Create your account key and a product key for each product in the dashboard under Settings → API keys."

/** A CogniCloud API key, read without a request: its kind and the workspace it names. */
export type ParsedKey = {
  kind: KeyKind
  /** The workspace as it appears in the key and in invoke URLs: its name as UTF-8, in lowercase hex. */
  tenantHex: string
}

/** Reads an account or product key, or throws `missing_key`, `retired_key` or `invalid_key`. */
export function parseKey(key: unknown): ParsedKey {
  if (typeof key !== "string" || key.trim() === "") {
    throw new CogniCloudError(0, "missing_key", `An API key is required. ${settings}`)
  }
  const old = retired.find((prefix) => key.startsWith(prefix))
  if (old) {
    throw new CogniCloudError(0, "retired_key", `Keys starting with ${old} were retired in SDK 1.0. ${settings}`)
  }
  const prefix = Object.keys(prefixes).find((candidate) => key.startsWith(candidate))
  const match = prefix ? /^([0-9a-f]+)_[A-Za-z0-9]+$/.exec(key.slice(prefix.length)) : null
  if (!prefix || !match || match[1].length % 2 !== 0) {
    throw new CogniCloudError(0, "invalid_key", `This is not a CogniCloud API key. ${settings}`)
  }
  return { kind: prefixes[prefix], tenantHex: match[1] }
}

/** The products a product key can reach. */
export type ProductName = Exclude<KeyKind, "account">

/** One product key per product, all from the account key's workspace. */
export type ProductKeys = Partial<Record<ProductName, string>>

export const accountKeyHeader = "x-cognicloud-account-key"

const productLabels: Record<ProductName, string> = {
  gateway: "AI Gateway",
  database: "Database",
  browser: "Browser",
  mail: "Mail",
  agents: "Agents",
  vault: "Vault",
}

/** Checks the account key and every product key: right kinds, one workspace. Returns the workspace. */
export function checkKeys(accountKey: unknown, productKeys: ProductKeys = {}): ParsedKey {
  if (typeof accountKey !== "string" || accountKey.trim() === "") {
    throw new CogniCloudError(0, "missing_account_key", `An account key is required. ${settings}`)
  }
  const account = parseKey(accountKey)
  if (account.kind !== "account") {
    throw new CogniCloudError(0, "invalid_key", `accountKey must be an account key (cc_acc_…). ${settings}`)
  }
  for (const [product, key] of Object.entries(productKeys) as [ProductName, string | undefined][]) {
    if (key === undefined) continue
    const parsed = parseKey(key)
    if (parsed.kind !== product) {
      throw new CogniCloudError(0, "invalid_key", `productKeys.${product} must be a ${productLabels[product]} key.`)
    }
    if (parsed.tenantHex !== account.tenantHex) {
      throw new CogniCloudError(0, "key_mismatch", "The account key and the product keys must be from one workspace.")
    }
  }
  return account
}

/** The headers of a call to one product: its product key as the Bearer token, plus the account key. */
export function pairHeaders(accountKey: string, productKeys: ProductKeys, product: ProductName): Record<string, string> {
  const key = productKeys[product]
  if (!key) {
    throw new CogniCloudError(
      0,
      "missing_product_key",
      `Add ${product === "gateway" ? "an" : "a"} ${productLabels[product]} product key to productKeys.${product}. ${settings}`,
    )
  }
  return { authorization: `Bearer ${key}`, [accountKeyHeader]: accountKey }
}
