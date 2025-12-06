import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

import storeData, {
  type Cfg,
  type ArticleAssetStorage,
  toIsoUtc,
  toYYYYMM,
  monthFromIsoUsingJST,
  lastNDaysRange,
} from './storeData';

import type Article from './article';

function createAssetStorageMock(bucket = 'article-assets'): { storage: ArticleAssetStorage; send: jest.Mock } {
  const send = jest.fn(async () => ({}));
  return {
    storage: {
      client: { send } as unknown as ArticleAssetStorage['client'],
      bucket,
    },
    send,
  };
}

describe('dynamoDB/storeData helpers', () => {
  it('normalizes ISO date inputs', () => {
    expect(toIsoUtc('2024-01-15')).toBe('2024-01-15T00:00:00.000Z');
    expect(toIsoUtc('2024-01-15T12:34:56.000Z')).toBe('2024-01-15T12:34:56.000Z');
  });

  it('computes JST-aligned month from ISO timestamps', () => {
    const iso = '2024-01-31T16:00:00.000Z'; // +9h => 2024-02-01 JST
    expect(monthFromIsoUsingJST(iso)).toBe('2024-02');
  });

  it('derives YYYY-MM strings from loose inputs', () => {
    const base = new Date('2023-01-05T00:00:00.000Z');
    expect(toYYYYMM('4', base)).toBe('2023-04');
    expect(toYYYYMM('11', base)).toBe('2023-11');
  });

  it('computes lastNDaysRange windows', () => {
    const now = new Date('2024-04-10T00:00:00.000Z');
    const { start, end } = lastNDaysRange(3, now);
    expect(end).toBe('2024-04-10T00:00:00.000Z');
    expect(start).toBe('2024-04-07T00:00:00.000Z');
  });
});

const region = process.env.AWS_REGION!;
const endpoint =
  process.env.AWS_ENDPOINT_URL ??
  process.env.LOCALSTACK_URL ??
  process.env.LOCALSTACK_ENDPOINT;
const persistentTableName =
  process.env.STORE_DATA_TEST_TABLE ?? process.env.ARTICLE_TABLE_NAME ?? 'PoliTopics';

describe('storeData (LocalStack integration)', () => {
  if (!endpoint) {
    it('skips when AWS_ENDPOINT_URL is not set', () => {
      expect(true).toBe(true);
    });
    return;
  }

  const dynamoClient = new DynamoDBClient({
    region,
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    },
  });
  const docClient = DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: { removeUndefinedValues: true },
  });

  it('writes to the shared PoliTopics table so records can be inspected manually', async () => {
    const article = buildArticle(`article-ls-${Date.now()}`);

    const assetMock = createAssetStorageMock();
    await storeData({ doc: docClient, table_name: persistentTableName, assets: assetMock.storage }, article);

    const mainItem = await docClient.send(
      new GetCommand({
        TableName: persistentTableName,
        Key: { PK: `A#${article.id}`, SK: 'META' },
      }),
    );
    expect(mainItem.Item?.title).toBe(article.title);

    const categoryItems = await docClient.send(
      new QueryCommand({
        TableName: persistentTableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `CATEGORY#${article.categories[0]}`,
        },
      }),
    );
    expect(categoryItems.Items?.some((item) => item.articleId === article.id)).toBe(true);
  });
});

describe('storeData (mocked client)', () => {
  const baseArticle: Article = {
    id: 'article-123',
    title: 'Example Article',
    date: '2024-05-01',
    month: '2024-05',
    imageKind: '会議録',
    session: 12,
    nameOfHouse: 'Lower House',
    nameOfMeeting: 'Committee A',
    categories: ['budget'],
    description: 'Internal description',
    summary: { based_on_orders: [1, 2], summary: '審議の全体像を説明' },
    soft_summary: { based_on_orders: [1], summary: '丁寧に要点を紹介' },
    middle_summary: [{ based_on_orders: [1], summary: '補正予算案で政府と野党が議論' }],
    dialogs: [{
      order: 1,
      summary: 'Aliceが予算の遅れを指摘',
      soft_language: 'Aliceさんは落ち着いた口調で遅延を確認しました',
      speaker: 'Alice',
    }],
    participants: [{
      name: 'Alice',
      position: '議員',
      summary: '執行遅れを質した',
      based_on_orders: [1],
    }],
    keywords: [{ keyword: 'finance', priority: 'high' }],
    terms: [{ term: 'policy', definition: '国の方針' }],
  };

  function buildCfg(send: jest.Mock, assets?: ArticleAssetStorage): Cfg {
    return {
      doc: { send } as unknown as DynamoDBDocumentClient,
      table_name: 'ArticlesTable',
      assets: assets ?? createAssetStorageMock().storage,
    };
  }

  it('writes the primary item and thin indexes', async () => {
    const send = jest.fn(async (command: any) => {
      if (command instanceof BatchWriteCommand) {
        return { UnprocessedItems: {} };
      }
      return {};
    });

    const assetMock = createAssetStorageMock();
    await storeData(buildCfg(send, assetMock.storage), baseArticle);

    expect(send).toHaveBeenCalledTimes(2);
    expect(assetMock.send).toHaveBeenCalledTimes(1);

    const putCall = send.mock.calls.find(([cmd]) => cmd instanceof PutCommand);
    expect(putCall).toBeDefined();
    const putInput = (putCall![0] as PutCommand).input;
    expect(putInput.TableName).toBe('ArticlesTable');
    expect(putInput.Item).toMatchObject({
      PK: 'A#article-123',
      SK: 'META',
      type: 'ARTICLE',
      GSI1PK: 'ARTICLE',
    });
    const putItem = putInput.Item!;
    expect(putItem.summary).toBeUndefined();
    expect(putItem.soft_summary).toBeUndefined();
    expect(putItem.middle_summary).toBeUndefined();
    expect(putItem.dialogs).toBeUndefined();
    expect(putItem.payload_url).toBe('s3://article-assets/articles/article-123/payload.json');

    const batchCall = send.mock.calls.find(([cmd]) => cmd instanceof BatchWriteCommand);
    expect(batchCall).toBeDefined();
    const batchInput = (batchCall![0] as BatchWriteCommand).input;
    const requests = batchInput.RequestItems?.ArticlesTable ?? [];
    expect(requests).toHaveLength(8);
    const requestBodies = requests.map((item) => item.PutRequest?.Item);
    expect(requestBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ PK: 'CATEGORY#budget', kind: 'CATEGORY_INDEX' }),
        expect.objectContaining({ PK: 'PERSON#Alice', kind: 'PERSON_INDEX' }),
        expect.objectContaining({ PK: 'KEYWORD#finance', kind: 'KEYWORD_INDEX' }),
        expect.objectContaining({ PK: 'KEYWORD_RECENT', kind: 'KEYWORD_OCCURRENCE' }),
        expect.objectContaining({ PK: 'IMAGEKIND#会議録', kind: 'IMAGEKIND_INDEX' }),
        expect.objectContaining({ PK: 'SESSION#0012', kind: 'SESSION_INDEX' }),
        expect.objectContaining({ PK: 'HOUSE#Lower House', kind: 'HOUSE_INDEX' }),
        expect.objectContaining({ PK: 'MEETING#Committee A', kind: 'MEETING_INDEX' }),
      ]),
    );
  });

  it('creates base thin indexes even without optional facets', async () => {
    const send = jest.fn(async (command: any) => {
      if (command instanceof BatchWriteCommand) {
        return { UnprocessedItems: {} };
      }
      return {};
    });

    const minimalistArticle = {
      ...baseArticle,
      categories: [],
      participants: [],
      keywords: [],
      nameOfHouse: '',
      nameOfMeeting: '',
    };

    await storeData(buildCfg(send), minimalistArticle);

    const batchCall = send.mock.calls.find(([cmd]) => cmd instanceof BatchWriteCommand);
    expect(batchCall).toBeDefined();
    const requests = (batchCall![0] as BatchWriteCommand).input.RequestItems?.ArticlesTable ?? [];
    expect(requests).toHaveLength(2);
    const items = requests.map((item) => item.PutRequest?.Item);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ PK: 'IMAGEKIND#会議録', kind: 'IMAGEKIND_INDEX' }),
        expect.objectContaining({ PK: 'SESSION#0012', kind: 'SESSION_INDEX' }),
      ]),
    );
  });
});

function buildArticle(id: string): Article {
  return {
    id,
    title: 'Example Article',
    date: '2024-05-01',
    month: '2024-05',
    imageKind: '会議録',
    session: 12,
    nameOfHouse: 'Lower House',
    nameOfMeeting: 'Committee A',
    categories: ['budget'],
    description: 'Internal description',
    summary: { based_on_orders: [1, 2], summary: '審議の全体像を説明' },
    soft_summary: { based_on_orders: [1], summary: '丁寧に要点を紹介' },
    middle_summary: [{ based_on_orders: [1], summary: '補正予算案で政府と野党が議論' }],
    dialogs: [{
      order: 1,
      summary: 'Aliceが予算の遅れを指摘',
      soft_language: 'Aliceさんは落ち着いた口調で遅延を確認しました',
      speaker: 'Alice',
    }],
    participants: [{
      name: 'Alice',
      position: '議員',
      summary: '執行遅れを質した',
      based_on_orders: [1],
    }],
    keywords: [{ keyword: 'finance', priority: 'high' }],
    terms: [{ term: 'policy', definition: '国の方針' }],
  };
}
