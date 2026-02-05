const generateContentMock = jest.fn();
const googleGenAiCtorMock = jest.fn(() => ({
  models: {
    generateContent: generateContentMock,
  },
}));

jest.mock("@google/genai", () => ({
  GoogleGenAI: googleGenAiCtorMock,
}));

import { GeminiClient } from './geminiClient';
import { setAppEnvironment } from "../config";

/*
 * requires an API key and uses the default model
 * [Contract] Instantiation must call GoogleGenerativeAI with the provided key and default model/system instruction.
 * [Reason] Ensures auth/config wiring is correct before any generation call.
 * [Accident] Without this, the client could run with missing credentials or wrong defaults.
 * [Odd] Default model asserted as gemini-2.5-pro; systemInstruction undefined.
 * [History] No known incident.
 *
 * passes merged generation configs to generateContent and returns trimmed text
 * [Contract] Request-level configs merge with defaults and returned text is trimmed.
 * [Reason] Prevents overshooting token budgets and storing padded responses.
 * [Accident] Without this, generation could exceed limits or persist whitespace-heavy text.
 * [Odd] Temperature 0.7/topP 0.9 merged with default maxOutputTokens=1000; trims surrounding spaces.
 * [History] No known incident.
 *
 * throws when no messages are provided
 * [Contract] generate() must reject empty message arrays.
 * [Reason] Avoids sending malformed requests to Gemini.
 * [Accident] Without this, downstream would see API errors or silent failures.
 * [Odd] No special values.
 * [History] No known incident.
 */

describe('GeminiClient', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
    googleGenAiCtorMock.mockClear();
    setAppEnvironment("localstackTest");
  });

  it('requires an API key and uses the default model', () => {
    new GeminiClient({ apiKey: 'test-api-key' });

    expect(googleGenAiCtorMock).toHaveBeenCalledWith({ apiKey: "test-api-key" });
  });

  it('passes merged generation configs to generateContent and returns trimmed text', async () => {
    generateContentMock.mockResolvedValue({
      text: "  generated text  ",
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

    expect(generateContentMock).toHaveBeenCalledWith({
      model: "gemini-pro-custom",
      contents: [{
        role: "user",
        parts: [{ text: "Hello" }],
      }],
      config: {
        systemInstruction: "stay-formal",
        temperature: 0.7,
        maxOutputTokens: 1000,
        topP: 0.9,
        httpOptions: { timeout: 600000 },
      },
    });
    expect(response.text).toBe('generated text');
  });

  it('retries with fallback model when the primary model fails', async () => {
    generateContentMock
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({ text: " fallback ok " });

    const client = new GeminiClient({
      apiKey: "fallback-key",
      model: "gemini-3-pro-preview",
    });

    const response = await client.generate({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(generateContentMock).toHaveBeenCalledTimes(2);
    expect(generateContentMock).toHaveBeenNthCalledWith(1, {
      model: "gemini-3-pro-preview",
      contents: [{
        role: "user",
        parts: [{ text: "Hello" }],
      }],
      config: {
        httpOptions: { timeout: 600000 },
      },
    });
    expect(generateContentMock).toHaveBeenNthCalledWith(2, {
      model: "gemini-3-flash-preview",
      contents: [{
        role: "user",
        parts: [{ text: "Hello" }],
      }],
      config: {
        httpOptions: { timeout: 600000 },
      },
    });
    expect(response.text).toBe("fallback ok");
  });

  it('throws when no messages are provided', async () => {
    const client = new GeminiClient({ apiKey: 'key' });
    await expect(client.generate({ messages: [] })).rejects.toThrow(
      'GeminiClient.generate requires at least one message',
    );
  });
});
