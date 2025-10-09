import type { SQSRecord } from 'aws-lambda';

import { parseMapPromptTaskMessage, type MapPromptTaskMessage } from '../sqs/map';
import { parseReducePromptTaskMessage, type ReducePromptTaskMessage } from '../sqs/reduce';

export type PromptTaskMessage = MapPromptTaskMessage | ReducePromptTaskMessage;

export function parsePromptTaskMessage(record: SQSRecord): PromptTaskMessage {
  const body = JSON.parse(record.body);
  if (body.type == "map") {
    return parseMapPromptTaskMessage(body);
  } else if (body.type == "reduce") {
    return parseReducePromptTaskMessage(body);
  }
  throw new Error('Invalid prompt task message');
}
