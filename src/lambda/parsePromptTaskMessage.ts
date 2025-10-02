import type { SQSRecord } from 'aws-lambda';

import { parseChunkPromptTaskMessage, type ChunkPromptTaskMessage } from '../sqs/chunk';
import { parseReducePromptTaskMessage, type ReducePromptTaskMessage } from '../sqs/reduce';

export type PromptTaskMessage = ChunkPromptTaskMessage | ReducePromptTaskMessage;

export function parsePromptTaskMessage(record: SQSRecord): PromptTaskMessage {
  try {
    return parseChunkPromptTaskMessage(record.body);
  } catch (chunkErr) {
    try {
      return parseReducePromptTaskMessage(record.body);
    } catch (reduceErr) {
      const error = new Error('Unsupported SQS message payload');
      (error as any).chunkErr = chunkErr;
      (error as any).reduceErr = reduceErr;
      throw error;
    }
  }
}
