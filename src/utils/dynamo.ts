import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { appConfig } from "../config";

export function createDocumentClient(): DynamoDBDocumentClient {
  const base = appConfig.aws.clientConfig;
  const client = new DynamoDBClient(base as any);
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
}
