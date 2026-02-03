const countTokensMock = jest.fn();
const googleGenAiCtorMock = jest.fn(() => ({
  models: {
    countTokens: countTokensMock,
  },
}));

jest.mock("@google/genai", () => ({
  GoogleGenAI: googleGenAiCtorMock,
}));

import { countTokens } from "./tokenCounter";
import { appConfig } from "../config";

describe("countTokens", () => {
  beforeEach(() => {
    countTokensMock.mockReset();
    googleGenAiCtorMock.mockClear();
  });

  it("counts tokens using the configured model", async () => {
    countTokensMock.mockResolvedValue({ totalTokens: 42 });

    const total = await countTokens("hello world");

    expect(googleGenAiCtorMock).toHaveBeenCalledWith({ apiKey: appConfig.geminiApiKey });
    expect(countTokensMock).toHaveBeenCalledWith({
      model: appConfig.geminiModel,
      contents: [{ role: "user", parts: [{ text: "hello world" }] }],
    });
    expect(total).toBe(42);
  });
});
