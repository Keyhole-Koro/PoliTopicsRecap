import type { CreateBucketCommandInput } from '@aws-sdk/client-s3';
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

import {
  ensureObjectExists,
  fetchJsonObject,
  fetchObjectText,
  parseS3Uri,
} from 'src/utils/s3';

const region = process.env.AWS_REGION ?? 'ap-northeast-3';
const endpoint = process.env.AWS_ENDPOINT_URL ?? process.env.LOCALSTACK_URL ?? 'http://localhost:4566';

const bucketName = 'localstack-unit-' + Date.now();
const textKey = 'sample/test-object.txt';
const jsonKey = 'sample/test-object.json';
const textBody = 'hello from localstack s3 unit test';
const jsonBody = { hello: 'world', count: 3 };

describe('LocalStack S3 roundtrip using utils/s3 helpers', () => {
  const s3 = new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
  });

  beforeAll(async () => {
    const createConfig: CreateBucketCommandInput['CreateBucketConfiguration'] =
      region === 'us-east-1'
        ? undefined
        : ({ LocationConstraint: region as any } as CreateBucketCommandInput['CreateBucketConfiguration']);

    try {
      await s3.send(
        new CreateBucketCommand({
          Bucket: bucketName,
          ...(createConfig ? { CreateBucketConfiguration: createConfig } : {}),
        }),
      );
    } catch (err: any) {
      if (err?.name !== 'BucketAlreadyOwnedByYou') {
        throw err;
      }
    }
  });

  afterAll(async () => {
    await Promise.allSettled([
      s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: textKey })),
      s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: jsonKey })),
    ]);
    await s3.send(new DeleteBucketCommand({ Bucket: bucketName })).catch(() => undefined);
  });

  it('uploads text and JSON then reads them via utils', async () => {
    const textUri = `s3://${bucketName}/${textKey}`;
    const jsonUri = `s3://${bucketName}/${jsonKey}`;

    const { bucket: textBucket, key: textObjectKey } = parseS3Uri(textUri);
    const { bucket: jsonBucket, key: jsonObjectKey } = parseS3Uri(jsonUri);

    await Promise.all([
      s3.send(
        new PutObjectCommand({
          Bucket: textBucket,
          Key: textObjectKey,
          Body: textBody,
        }),
      ),
      s3.send(
        new PutObjectCommand({
          Bucket: jsonBucket,
          Key: jsonObjectKey,
          Body: JSON.stringify(jsonBody),
          ContentType: 'application/json',
        }),
      ),
    ]);

    expect(await ensureObjectExists(s3, textBucket, textObjectKey)).toBe(true);
    expect(await ensureObjectExists(s3, jsonBucket, jsonObjectKey)).toBe(true);

    const text = await fetchObjectText(s3, textBucket, textObjectKey);
    expect(text).toBe(textBody);

    const parsedJson = await fetchJsonObject<typeof jsonBody>(
      s3,
      jsonBucket,
      jsonObjectKey,
    );
    expect(parsedJson).toEqual(jsonBody);
  });
});
