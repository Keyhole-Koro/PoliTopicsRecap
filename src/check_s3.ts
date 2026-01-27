
import { S3Client, ListBucketsCommand, GetBucketLocationCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { appConfig } from "./config";

async function main() {
  console.log("Config:", JSON.stringify(appConfig.aws, null, 2));
  const client = new S3Client(appConfig.aws.clientConfig);

  try {
    console.log("Listing buckets...");
    const listRes = await client.send(new ListBucketsCommand({}));
    console.log("Buckets:", listRes.Buckets?.map(b => b.Name));

    const bucketName = "politopics-articles-local";
    console.log(`Checking location for ${bucketName}...`);
    try {
        const locRes = await client.send(new GetBucketLocationCommand({ Bucket: bucketName }));
        console.log("Bucket Location:", locRes.LocationConstraint);
    } catch (e: any) {
        console.error("GetBucketLocation failed:", e.message);
    }

    console.log(`Putting object to ${bucketName}...`);
    try {
        await client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: "test-check.txt",
            Body: "Hello World",
        }));
        console.log("PutObject success!");
    } catch (e: any) {
        console.error("PutObject failed:", e.message);
        if (e.name === 'SignatureDoesNotMatch') {
            console.error("Signature details:", e);
        }
    }

  } catch (err) {
    console.error("Error:", err);
  }
}

main();
