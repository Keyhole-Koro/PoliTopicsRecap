const generateContentMock = jest.fn();
const getGenerativeModelMock = jest.fn(() => ({ generateContent: generateContentMock }));
const googleGenerativeAiCtorMock = jest.fn(() => ({
  getGenerativeModel: getGenerativeModelMock,
}));

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: googleGenerativeAiCtorMock,
}));

import { GeminiClient } from 'src/llm/geminiClient';

describe('GeminiClient', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
    getGenerativeModelMock.mockClear();
    googleGenerativeAiCtorMock.mockClear();
  });

  it('requires an API key and uses the default model', () => {
    process.env.GEMINI_API_KEY = 'test-api-key';
    new GeminiClient();

    expect(googleGenerativeAiCtorMock).toHaveBeenCalledWith('test-api-key');
    expect(getGenerativeModelMock).toHaveBeenCalledWith({
      model: 'gemini-1.5-pro',
      systemInstruction: undefined,
    });
  });

  it('passes merged generation configs to generateContent and returns trimmed text', async () => {
    process.env.GEMINI_API_KEY = 'another-key';
    generateContentMock.mockResolvedValue({
      response: {
        text: () => '  generated text  ',
      },
    });

    const client = new GeminiClient({
      defaultGenerationConfig: { temperature: 0.4, maxOutputTokens: 1000 },
      systemInstruction: 'stay-formal',
      model: 'gemini-pro-custom',
    });

    const response = await client.generate({
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.7,
      topP: 0.9,
    });

    expect(getGenerativeModelMock).toHaveBeenCalledWith({
      model: 'gemini-pro-custom',
      systemInstruction: 'stay-formal',
    });
    expect(generateContentMock).toHaveBeenCalledWith({
      contents: [{
        role: 'system',
        parts: [{ text: 'Hello' }],
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1000,
        topP: 0.9,
      },
    });
    expect(response.text).toBe('generated text');
  });

  it('throws when no messages are provided', async () => {
    process.env.GEMINI_API_KEY = 'key';
    const client = new GeminiClient();
    await expect(client.generate({ messages: [] })).rejects.toThrow(
      'GeminiClient.generate requires at least one message',
    );
  });
});
