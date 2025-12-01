import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { getAwsBaseConfig } from "./aws";

export function createDocumentClient(): DynamoDBDocumentClient {
  const base = getAwsBaseConfig();
  const client = new DynamoDBClient(base);
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
}
