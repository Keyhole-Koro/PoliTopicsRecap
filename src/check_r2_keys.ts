
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import { appConfig } from "./config";

async function main() {
  console.log(`[CheckR2] Environment: ${appConfig.environment}`);
  
  console.log(`[CheckR2] Configured Endpoint: ${appConfig.r2.endpoint}`);
  console.log(`[CheckR2] Configured Region: ${appConfig.r2.region}`);
  console.log(`[CheckR2] AccessKeyID: ${appConfig.r2.accessKeyId.slice(0, 4)}***`);

  try {
    const client = new S3Client(appConfig.r2.clientConfig);
    console.log("[CheckR2] Attempting ListBuckets...");
    const result = await client.send(new ListBucketsCommand({}));
    console.log("[CheckR2] Success! Buckets:", result.Buckets?.map(b => b.Name));
  } catch (error: any) {
    console.error("[CheckR2] Failed:", error.message);
    if (error.name === 'SignatureDoesNotMatch') {
        console.error("[CheckR2] Signature Mismatch! Please verify R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.");
    }
  }
}

main().catch(console.error);
