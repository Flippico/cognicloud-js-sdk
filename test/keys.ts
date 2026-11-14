const tenant = "636f676e69636c6f7564"
const key = (prefix: string, fill: string) => `${prefix}${tenant}_${fill.repeat(64)}`

export const KEY = key("cc_acc_", "a")
export const PRODUCT_KEYS = {
  gateway: key("cc_gw_", "1"),
  database: key("cc_db_", "2"),
  browser: key("cc_br_", "3"),
  mail: key("cc_ml_", "4"),
  agents: key("cc_ag_", "5"),
}
export const KEYS = { accountKey: KEY, productKeys: PRODUCT_KEYS }
