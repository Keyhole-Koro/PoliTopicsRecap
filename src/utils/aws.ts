// utils/aws.ts
import type { S3ClientConfig } from '@aws-sdk/client-s3';
import { appConfig } from "../config";

type AwsBaseConfig = {
  region: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
};

export function getAwsRegion(): string {
  return appConfig.aws.region;
}

export function getAwsEndpoint(): string | undefined {
  return appConfig.aws.endpoint;
}

export function getAwsBaseConfig(): AwsBaseConfig {
  const { region, endpoint, credentials } = appConfig.aws;
  return endpoint ? { region, endpoint, credentials } : { region, credentials };
}

export function getS3ClientConfig(): S3ClientConfig {
  const base = getAwsBaseConfig();
  return {
    ...base,
    forcePathStyle: appConfig.aws.forcePathStyle,
  };
}

/**
 * Get S3ClientConfig for Cloudflare R2.
 * R2 uses S3-compatible API with custom endpoint and credentials.
 * Returns null if R2 is not configured (e.g., local/test environment).
 */
export function getR2ClientConfig(): S3ClientConfig | null {
  const r2 = appConfig.r2;
  if (!r2) return null;
  
  return {
    region: r2.region,
    endpoint: r2.endpoint,
    credentials: {
      accessKeyId: r2.accessKeyId,
      secretAccessKey: r2.secretAccessKey,
    },
    forcePathStyle: true, // R2 requires path-style access
  };
}

/**
 * Get R2 bucket name from config.
 * Returns null if R2 is not configured.
 */
export function getR2Bucket(): string | null {
  return appConfig.r2?.bucket ?? null;
}

/**
 * Get R2 public URL base from config.
 * Used for generating public asset URLs.
 * Returns null if R2 is not configured.
 */
export function getR2PublicUrlBase(): string | null {
  return appConfig.r2?.publicUrlBase ?? null;
}

/**
 * Build a public URL for an R2 asset.
 * Falls back to s3:// format if R2 is not configured.
 */
export function buildAssetUrl(bucket: string, key: string): string {
  const publicBase = getR2PublicUrlBase();
  if (publicBase) {
    // R2 public URL: https://asset.politopics.net/{key}
    return `${publicBase.replace(/\/+$/, "")}/${key}`;
  }
  // Fallback to S3 URI format
  return `s3://${bucket}/${key}`;
}
