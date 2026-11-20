import { CogniCloudError } from "./errors.js"
import { send, type HttpConfig } from "./http.js"
import type {
  CreateStorageBucketInput,
  StorageBucket,
  StorageBucketList,
  StorageDeleteOptions,
  StorageDownloadOptions,
  StorageObjectListOptions,
  StorageObjectMetadata,
  StorageObjectPage,
  StorageUploadOptions,
  UpdateStorageBucketInput,
} from "./types.js"

const controlCharacter = /[\u0000-\u001f\u007f-\u009f]/

/** The service's segment rule: no `.` or `..`, and no empty segment except a trailing one. */
function segmentsOk(value: string): boolean {
  if (controlCharacter.test(value)) return false
  const parts = value.split("/")
  const last = parts.length - 1
  return parts.every((part, index) => (part !== "" || index === last) && part !== "." && part !== "..")
}

function invalidKey(): CogniCloudError {
  return new CogniCloudError(
    0,
    "invalid_key",
    "An object key or prefix may not be empty, start with /, contain an empty, . or .. segment, or contain a control character.",
  )
}

/** Refuses a key the service would reject, or that a URL parser would rewrite (`x/../y` becomes `y`), before any request. */
function checkKey(key: string): string {
  if (key === "" || !segmentsOk(key)) throw invalidKey()
  return key
}

/** A listing prefix may be empty or end mid-name. */
function checkPrefix(prefix: string): string {
  if (prefix !== "" && !segmentsOk(prefix)) throw invalidKey()
  return prefix
}

/** Encodes each segment of an object key and keeps the slashes between them. */
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

/** Creates, lists, changes and deletes buckets. */
export class StorageBucketsApi {
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>

  constructor(config: HttpConfig, headers: Record<string, string>) {
    this.config = config
    this.headers = headers
  }

  /** By name. */
  async list(): Promise<StorageBucket[]> {
    const body = await send<StorageBucketList>(this.config, { method: "GET", path: "/buckets", headers: this.headers })
    return body.buckets
  }

  create(input: CreateStorageBucketInput): Promise<StorageBucket> {
    return send(this.config, { method: "POST", path: "/buckets", headers: this.headers, body: input, retry: false })
  }

  get(name: string): Promise<StorageBucket> {
    return send(this.config, { method: "GET", path: `/buckets/${encodeURIComponent(name)}`, headers: this.headers })
  }

  update(name: string, patch: UpdateStorageBucketInput): Promise<StorageBucket> {
    return send(this.config, {
      method: "PATCH",
      path: `/buckets/${encodeURIComponent(name)}`,
      headers: this.headers,
      body: patch,
      retry: false,
    })
  }

  /** Refused with `409` (`conflict`) while the bucket holds objects, unless `force` is true: then its objects go with it. */
  delete(name: string, options: StorageDeleteOptions = {}): Promise<void> {
    const suffix = options.force ? "?force=true" : ""
    return send(this.config, {
      method: "DELETE",
      path: `/buckets/${encodeURIComponent(name)}${suffix}`,
      headers: this.headers,
      retry: false,
    })
  }
}

/** Uploads, downloads, lists and deletes objects in a bucket. Invalid keys and prefixes reject before any request. */
export class StorageObjectsApi {
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>

  constructor(config: HttpConfig, headers: Record<string, string>) {
    this.config = config
    this.headers = headers
  }

  private path(bucket: string, key?: string): string {
    const base = `/buckets/${encodeURIComponent(bucket)}/objects`
    return key === undefined ? base : `${base}/${encodeKey(key)}`
  }

  /** One page, with folders when a delimiter groups keys (`/` by default). Pass `nextCursor` back to go on. */
  async list(bucket: string, options: StorageObjectListOptions = {}): Promise<StorageObjectPage> {
    const query = new URLSearchParams()
    if (options.prefix !== undefined) query.set("prefix", checkPrefix(options.prefix))
    if (options.delimiter !== undefined) query.set("delimiter", options.delimiter)
    if (options.cursor !== undefined) query.set("cursor", options.cursor)
    if (options.limit !== undefined) query.set("limit", String(options.limit))
    const suffix = query.size > 0 ? `?${query.toString()}` : ""
    return send(this.config, { method: "GET", path: `${this.path(bucket)}${suffix}`, headers: this.headers })
  }

  /**
   * Every page, from `options.cursor` on, one at a time: `for await (const page of storage.objects.pages("assets"))`.
   * Each page is a request, so stop early with `break`.
   */
  async *pages(bucket: string, options: StorageObjectListOptions = {}): AsyncGenerator<StorageObjectPage> {
    let cursor = options.cursor
    do {
      const page = await this.list(bucket, { ...options, cursor })
      yield page
      cursor = page.nextCursor ?? undefined
    } while (cursor)
  }

  /** Stores the bytes under `key`, replacing any object there. Up to 100 MB. Returns the stored object's metadata. */
  async upload(
    bucket: string,
    key: string,
    body: Uint8Array | ArrayBuffer | Blob,
    options: StorageUploadOptions = {},
  ): Promise<StorageObjectMetadata> {
    const path = this.path(bucket, checkKey(key))
    return send(this.config, {
      method: "PUT",
      path,
      headers: this.headers,
      raw: { body: body as BodyInit, contentType: options.contentType ?? "application/octet-stream" },
      retry: false,
    })
  }

  /**
   * The object's bytes. With `range`, the requested part only. Read the whole object into memory: for large
   * files, raise `timeoutMs`, which covers the whole download.
   */
  async download(bucket: string, key: string, options: StorageDownloadOptions = {}): Promise<Uint8Array> {
    const path = this.path(bucket, checkKey(key))
    return send(this.config, {
      method: "GET",
      path,
      headers: options.range === undefined ? this.headers : { ...this.headers, range: options.range },
      binary: true,
    })
  }

  /** Size, type, etag and last modified time, without the bytes. */
  async metadata(bucket: string, key: string): Promise<StorageObjectMetadata> {
    const path = this.path(bucket, checkKey(key))
    return send(this.config, { method: "GET", path: `${path}?metadata=true`, headers: this.headers })
  }

  async delete(bucket: string, key: string): Promise<void> {
    const path = this.path(bucket, checkKey(key))
    return send(this.config, { method: "DELETE", path, headers: this.headers, retry: false })
  }
}

/** Folders are marker objects, so an empty folder stays listed. */
export class StorageFoldersApi {
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>

  constructor(config: HttpConfig, headers: Record<string, string>) {
    this.config = config
    this.headers = headers
  }

  /** Creates the folder `prefix`. Creating one that already exists is fine. */
  async create(bucket: string, prefix: string): Promise<void> {
    checkKey(prefix)
    return send(this.config, {
      method: "POST",
      path: `/buckets/${encodeURIComponent(bucket)}/folders`,
      headers: this.headers,
      body: { prefix },
      retry: false,
    })
  }
}

/** Buckets and their objects. Needs `productKeys.storage` (`cc_st_`). */
export class StorageApi {
  readonly buckets: StorageBucketsApi
  readonly objects: StorageObjectsApi
  readonly folders: StorageFoldersApi

  constructor(config: HttpConfig, headers: Record<string, string>) {
    this.buckets = new StorageBucketsApi(config, headers)
    this.objects = new StorageObjectsApi(config, headers)
    this.folders = new StorageFoldersApi(config, headers)
  }
}
