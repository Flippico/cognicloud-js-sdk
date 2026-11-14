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

const settings = "Create an account key or a product key in the dashboard under Settings → API keys."

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
