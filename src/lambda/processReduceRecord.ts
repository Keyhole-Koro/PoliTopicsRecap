import type { S3Client } from '@aws-sdk/client-s3';
import type { SQSClient } from '@aws-sdk/client-sqs';
import type { SQSRecord } from 'aws-lambda';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import type { ReducePromptTaskMessage } from '../sqs/reduce';
import { ensureObjectExists, fetchJsonObject, parseS3Uri } from '../utils/s3';
import { deleteMessage, pickRequeueDelaySeconds, requeueWithDelay } from './sqsActions';
import { LlmClient } from '@llm/llmClient';
import storeData, { Article } from 'src/dynamoDB/storeData';

export interface ProcessReduceRecordArgs {
  message: ReducePromptTaskMessage;
  record: SQSRecord;
  queueUrl: string;
  sqsClient: SQSClient;
  s3Client: S3Client;
  llmClient: LlmClient;
}

export async function processReduceRecord({
  message,
  record,
  queueUrl,
  sqsClient,
  s3Client,
  llmClient,
}: ProcessReduceRecordArgs): Promise<void> {
  try {
    
    const ddbClient = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(ddbClient);


    const referencedUris = new Set<string>(message.chunk_result_urls);
    const missingSources = await findMissingObjects(s3Client, Array.from(referencedUris));

    if (missingSources.length > 0) {
      console.warn('Reduce prerequisites missing; requeueing', {
        messageId: record.messageId,
        missingSources,
      });
      await requeueWithDelay({
        sqsClient,
        queueUrl,
        record,
        message,
        delaySeconds: message.retryMs_in,
      });
      return;
    }

    const chunkResults = await Promise.all(
      message.chunk_result_urls.map(async (uri) => {
        const { bucket, key } = parseS3Uri(uri);
        return fetchJsonObject<Record<string, unknown>>(s3Client, bucket, key);
      }),
    );

    const combinedPrompt = buildReducePrompt(message, chunkResults);

    console.log('Reduce message ready for LLM processing', {
      messageId: record.messageId,
      issueID: message.issueID,
      retryAttempts: message.retryAttempts,
      promptLength: combinedPrompt.length,
    });

    const result = await llmClient.generate({
      messages: [{ role: 'user', content: combinedPrompt }],
    });

    // add keywords, participants, and other metadata later
    /*
    await storeData({
      doc: docClient,
      table_name: 'politopics',
      },
      
    );
    */

    await deleteMessage({ sqsClient, queueUrl, receiptHandle: record.receiptHandle });
    // remove s3 objects later
  } catch (err) {
    console.error('Reduce processing failed; rescheduling', {
      messageId: record.messageId,
      error: err,
    });
    await requeueWithDelay({
      sqsClient,
      queueUrl,
      record,
      message,
      delaySeconds: message.retryMs_in,
    });
  }
}

async function findMissingObjects(s3Client: S3Client, uris: string[]): Promise<string[]> {
  const missing: string[] = [];

  await Promise.all(
    uris.map(async (uri) => {
      const { bucket, key } = parseS3Uri(uri);
      const exists = await ensureObjectExists(s3Client, bucket, key);
      if (!exists) {
        missing.push(uri);
      }
    }),
  );

  return missing;
}

function buildReducePrompt(
  message: ReducePromptTaskMessage,
  chunkResults: Array<Record<string, unknown>>,
): string {
  const summaries: string[] = [];
  const participants: string[] = [];

  for (const result of chunkResults) {
    const middleSummary = typeof result.middleSummary === 'string' ? result.middleSummary : undefined;
    if (middleSummary) {
      summaries.push(middleSummary);
    }

    const chunkParticipants = Array.isArray(result.participants)
      ? result.participants.filter((p): p is string => typeof p === 'string')
      : [];

    participants.push(...chunkParticipants);
  }

  const meetingInfo = `Meeting: ${message.meeting.nameOfMeeting} (${message.meeting.nameOfHouse}) on ${message.meeting.date}`;
  const expectedChunks = message.chunk_result_urls.length;

  const lines = [
    message.prompt,
    '',
    meetingInfo,
    `Issue ID: ${message.issueID}`,
    `Chunks received: ${chunkResults.length} / ${expectedChunks}`,
    '',
    'Participants:',
    ...(participants.length > 0 ? participants : ['(none provided)']),
    '',
    'Chunk Summaries:',
    ...(summaries.length > 0 ? summaries : ['(none provided)']),
  ];

  return lines.join('\n');
}
