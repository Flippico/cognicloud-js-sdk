import { CogniCloudError } from "./errors.js"
import type { FilePart, ImagePart, InputFile, InputImage, InputText, TextPart } from "./types.js"

/** The largest file the gateway accepts, decoded. */
export const maxFileBytes = 10 * 1024 * 1024

export type ImageType = "image/png" | "image/jpeg" | "image/webp" | "image/gif"

/** Base64 of raw bytes, in any runtime that has `btoa`. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function checked(data: Uint8Array | ArrayBuffer): Uint8Array {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes.byteLength > maxFileBytes) {
    throw new CogniCloudError(0, "file_too_large", "A file may be at most 10 MB.")
  }
  return bytes
}

function dataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${toBase64(bytes)}`
}

/** A text part for a chat message. */
export function textPart(text: string): TextPart {
  return { type: "text", text }
}

/** A PDF part for a chat message. */
export function pdfPart(data: Uint8Array | ArrayBuffer, filename = "document.pdf"): FilePart {
  return { type: "file", file: { filename, file_data: dataUrl("application/pdf", checked(data)) } }
}

/** An image part for a chat message. */
export function imagePart(data: Uint8Array | ArrayBuffer, type: ImageType): ImagePart {
  return { type: "image_url", image_url: { url: dataUrl(type, checked(data)) } }
}

/** Text for a Responses API input message. */
export function inputText(text: string): InputText {
  return { type: "input_text", text }
}

/** A PDF for a Responses API input message. */
export function inputFile(data: Uint8Array | ArrayBuffer, filename = "document.pdf"): InputFile {
  return { type: "input_file", filename, file_data: dataUrl("application/pdf", checked(data)) }
}

/** An image for a Responses API input message. */
export function inputImage(data: Uint8Array | ArrayBuffer, type: ImageType): InputImage {
  return { type: "input_image", image_url: dataUrl(type, checked(data)) }
}
