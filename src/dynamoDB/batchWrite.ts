import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";

// ==========================
// BatchWrite helper (max 25 per request) with simple retry
// ==========================
export async function batchPutAll(
  doc: DynamoDBDocumentClient,
  table: string,
  items: any[]
) {
  let i = 0;
  while (i < items.length) {
    const slice = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
    const res = await doc.send(
      new BatchWriteCommand({ RequestItems: { [table]: slice } })
    );

    const unp = res.UnprocessedItems?.[table] ?? [];
    if (unp.length > 0) {
      // naive backoff + requeue unprocessed items into the current window
      await new Promise((r) => setTimeout(r, 200));
      const retryItems = unp.map((u) => u.PutRequest!.Item);
      items.splice(i, 0, ...retryItems);
    } else {
      i += 25;
    }
  }
}