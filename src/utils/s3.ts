// Minimal, pragmatic comments (style B)

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  ObjectCannedACL,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

export const PROMPT_BUCKET = 'politopics-prompts';

/**
 * Parse an S3 URI like `s3://bucket/key...` into { bucket, key }.
 * Throws if the URI format is invalid.
 */
export function parseS3Uri(uri: string): { bucket: string; key: string } {
  if (!uri.startsWith('s3://')) {
    throw new Error(`Invalid S3 URI: ${uri}`);
  }
  const remainder = uri.slice('s3://'.length);
  const slashIndex = remainder.indexOf('/');
  if (slashIndex <= 0 || slashIndex === remainder.length - 1) {
    throw new Error(`Invalid S3 URI: ${uri}`);
  }
  return {
    bucket: remainder.slice(0, slashIndex),
    key: remainder.slice(slashIndex + 1),
  };
}

/**
 * Check if an object exists (HEAD).
 * Returns true if present; false for 404/NotFound/403; rethrows otherwise.
 */
export async function ensureObjectExists(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err: any) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === 'NotFound' || err?.Code === 'NotFound') return false;
    if (status === 403) return false; // treat as missing for retry/backoff strategies
    throw err;
  }
}

/**
 * Fetch an object as UTF-8 text.
 * Throws if the body is empty or cannot be read.
 */
export async function fetchObjectText(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<string> {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = response.Body;
  if (body === undefined) {
    throw new Error(`Empty object body for s3://${bucket}/${key}`);
  }
  const data = await streamBodyToBuffer(body);
  return data.toString('utf8');
}

/**
 * Fetch and parse JSON into type T.
 * Throws with cause if JSON.parse fails.
 */
export async function fetchJsonObject<T>(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<T> {
  const text = await fetchObjectText(client, bucket, key);
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const error = new Error(`Failed to parse JSON from s3://${bucket}/${key}`);
    (error as any).cause = err;
    throw error;
  }
}

/* ======================
   Upload helpers (S3 v3)
   ====================== */

/**
 * Simple upload using PutObject.
 * Suitable for small/medium payloads; for large bodies prefer multipartUpload().
 */
export async function uploadObject(params: {
  client: S3Client;
  bucket: string;
  key: string;
  body: string | Uint8Array | Buffer | Readable;
  opts?: {
    contentType?: string;
    cacheControl?: string;
    metadata?: Record<string, string>;
    acl?: ObjectCannedACL; // e.g. 'private' | 'public-read'
  };
}): Promise<void> {
  const { client, bucket, key, body, opts } = params;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body as any,
      ContentType: opts?.contentType,
      CacheControl: opts?.cacheControl,
      Metadata: opts?.metadata,
      ACL: opts?.acl,
    }),
  );
}

/**
 * Upload JSON with UTF-8 encoding.
 * Automatically stringifies the input.
 */
export async function uploadJson(params: {
  client: S3Client;
  bucket: string;
  key: string;
  data: unknown;
  opts?: {
    pretty?: boolean;
    cacheControl?: string;
    metadata?: Record<string, string>;
    acl?: ObjectCannedACL;
    contentType?: string; // override default content-type if needed
  };
}): Promise<void> {
  const { client, bucket, key, data, opts } = params;

  const text = opts?.pretty
    ? JSON.stringify(data, null, 2)
    : JSON.stringify(data);

  await uploadObject({
    client,
    bucket,
    key,
    body: text,
    opts: {
      contentType: opts?.contentType ?? 'application/json; charset=utf-8',
      cacheControl: opts?.cacheControl,
      metadata: opts?.metadata,
      acl: opts?.acl,
    },
  });
}

/* ==========================
   Internal: body to Buffer
   ========================== */

/**
 * Normalize various AWS SDK body shapes to a Node.js Buffer.
 * Supports Buffer, Uint8Array, string, web streams (transformToByteArray), and Node Readable.
 */
async function streamBodyToBuffer(body: any): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body);
  if (body && typeof body.transformToByteArray === 'function') {
    const arr = await body.transformToByteArray();
    return Buffer.from(arr);
  }
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      if (typeof chunk === 'string') chunks.push(Buffer.from(chunk));
      else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
      else chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error('Unsupported S3 body type');
}
