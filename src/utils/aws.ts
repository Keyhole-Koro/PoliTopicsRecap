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
