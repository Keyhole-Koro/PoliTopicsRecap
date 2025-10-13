declare global {
  // eslint-disable-next-line no-var
  var __geminiGenerateMock: jest.Mock;
  // eslint-disable-next-line no-var
  var __geminiGetModelMock: jest.Mock;
  // eslint-disable-next-line no-var
  var __googleGenerativeAiCtorMock: jest.Mock;
}

const endpoint = process.env.AWS_ENDPOINT_URL ?? process.env.LOCALSTACK_URL ?? 'http://localhost:4566';
process.env.AWS_ENDPOINT_URL = endpoint;

if (!process.env.AWS_REGION) {
  process.env.AWS_REGION = 'ap-northeast-3';
}

if (!process.env.AWS_ACCESS_KEY_ID) {
  process.env.AWS_ACCESS_KEY_ID = 'test';
}

if (!process.env.AWS_SECRET_ACCESS_KEY) {
  process.env.AWS_SECRET_ACCESS_KEY = 'test';
}

process.env.AWS_S3_FORCE_PATH_STYLE = '1';

if (!process.env.GEMINI_API_KEY) {
  process.env.GEMINI_API_KEY = 'local-test-key';
}

const generateContentMock = jest.fn().mockResolvedValue({
  response: {
    text: () => 'stubbed llm output',
  },
});

const getGenerativeModelMock = jest.fn().mockReturnValue({
  generateContent: generateContentMock,
});

const GoogleGenerativeAI = jest.fn().mockImplementation(() => ({
  getGenerativeModel: getGenerativeModelMock,
}));

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI,
  GoogleGenerativeAIError: class GoogleGenerativeAIError extends Error {},
}));

global.__geminiGenerateMock = generateContentMock;
global.__geminiGetModelMock = getGenerativeModelMock;
global.__googleGenerativeAiCtorMock = GoogleGenerativeAI;

defineProperty(global, '__geminiGenerateMock', global.__geminiGenerateMock);
defineProperty(global, '__geminiGetModelMock', global.__geminiGetModelMock);
defineProperty(global, '__googleGenerativeAiCtorMock', global.__googleGenerativeAiCtorMock);

function defineProperty(target: any, key: string, value: unknown) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: false,
    writable: true,
    value,
  });
}

export {};
