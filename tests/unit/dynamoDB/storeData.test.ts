import { BatchWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import storeData, {
  type Article,
  type Cfg,
  toIsoUtc,
  toYYYYMM,
  monthFromIsoUsingJST,
  lastNDaysRange,
} from 'src/dynamoDB/storeData';

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

describe('storeData', () => {
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
    summary: {},
    soft_summary: {},
    middle_summary: [],
    dialogs: [{ speaker: 'Alice', text: 'hello' }],
    participants: [{ name: 'Alice' }],
    keywords: [{ keyword: 'finance' }],
    terms: [{ term: 'policy' }],
  };

  function buildCfg(send: jest.Mock): Cfg {
    return {
      doc: { send } as unknown as DynamoDBDocumentClient,
      table_name: 'ArticlesTable',
    };
  }

  it('writes the primary item and thin indexes', async () => {
    const send = jest.fn(async (command: any) => {
      if (command instanceof BatchWriteCommand) {
        return { UnprocessedItems: {} };
      }
      return {};
    });

    await storeData(buildCfg(send), baseArticle);

    expect(send).toHaveBeenCalledTimes(2);

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
