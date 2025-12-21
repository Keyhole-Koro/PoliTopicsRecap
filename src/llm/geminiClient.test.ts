const generateContentMock = jest.fn();
const getGenerativeModelMock = jest.fn(() => ({ generateContent: generateContentMock }));
const googleGenerativeAiCtorMock = jest.fn(() => ({
  getGenerativeModel: getGenerativeModelMock,
}));

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: googleGenerativeAiCtorMock,
}));

import { GeminiClient } from './geminiClient';

describe('GeminiClient', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
    getGenerativeModelMock.mockClear();
    googleGenerativeAiCtorMock.mockClear();
  });

  it('requires an API key and uses the default model', () => {
    new GeminiClient({ apiKey: 'test-api-key' });

    expect(googleGenerativeAiCtorMock).toHaveBeenCalledWith('test-api-key');
    expect(getGenerativeModelMock).toHaveBeenCalledWith({
      model: 'gemini-2.5-pro',
      systemInstruction: undefined,
    });
  });

  it('passes merged generation configs to generateContent and returns trimmed text', async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () => '  generated text  ',
      },
    });

    const client = new GeminiClient({
      apiKey: 'another-key',
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
        role: 'user',
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
    const client = new GeminiClient({ apiKey: 'key' });
    await expect(client.generate({ messages: [] })).rejects.toThrow(
      'GeminiClient.generate requires at least one message',
    );
  });
});
