import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

export const PROMPT_BUCKET = 'politopics-prompts';

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

export async function ensureObjectExists(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    return true;
  } catch (err: any) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === 'NotFound' || err?.Code === 'NotFound') {
      return false;
    }

    if (status === 403) {
      // Treat permission errors as missing for scheduling retries.
      return false;
    }

    throw err;
  }
}

export async function fetchObjectText(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<string> {
  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );

  const body = response.Body;
  if (body === undefined) {
    throw new Error(`Empty object body for s3://${bucket}/${key}`);
  }

  const data = await streamBodyToBuffer(body);
  return data.toString('utf8');
}

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

async function streamBodyToBuffer(body: any): Promise<Buffer> {
  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (typeof body === 'string') {
    return Buffer.from(body);
  }

  if (body && typeof body.transformToByteArray === 'function') {
    const arr = await body.transformToByteArray();
    return Buffer.from(arr);
  }

  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk));
      } else if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk));
      } else {
        chunks.push(Buffer.from(chunk));
      }
    }
    return Buffer.concat(chunks);
  }

  throw new Error('Unsupported S3 body type');
}

