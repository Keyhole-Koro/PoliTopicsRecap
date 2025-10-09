// utils/aws.ts
import type { S3ClientConfig } from '@aws-sdk/client-s3';

export function getAwsRegion(): string {
  return process.env.AWS_REGION || 'ap-northeast-3';
}

export function getAwsEndpoint(): string | undefined {
  const ep = process.env.AWS_ENDPOINT_URL;
  return ep && ep.trim().length ? ep : undefined;
}

export function getAwsBaseConfig(): { region: string; endpoint?: string; credentials?: { accessKeyId: string; secretAccessKey: string } } {
  const region = getAwsRegion();
  const endpoint = getAwsEndpoint();
  const isLocal = endpoint?.includes('localhost') || endpoint?.includes('127.0.0.1');

  const credentials = isLocal
    ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test' }
    : undefined;

  return endpoint ? { region, endpoint, credentials } : { region, credentials };
}

export function getS3ClientConfig(): S3ClientConfig {
  const base = getAwsBaseConfig();
  const endpoint = base.endpoint;
  const isLocal = endpoint?.includes('localhost') || endpoint?.includes('127.0.0.1');

  return {
    ...base,
    forcePathStyle: isLocal ? true : undefined,
  };
}
