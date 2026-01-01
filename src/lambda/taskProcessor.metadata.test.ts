import {
  attachSpeakerMetadata,
  extractSpeakerMapFromPrompt,
  extractSpeakerMapFromAttachedAssetsPayload,
} from "./speakerMetadata";

describe("attachSpeakerMetadata", () => {
  it("attaches speaker and original_text from prompt metadata", () => {
    // 1. Mock Prompt (JSON format as expected by extractSpeakerMapFromPrompt)
    // Simulating the prompt that contains the ground truth metadata
    const mockPrompt = JSON.stringify({
      speeches: [
        {
          speechOrder: 1,
          speaker: "Target Speaker",
          speech: "This is the original text from prompt.",
          speakerYomi: "ターゲットスピーカー",
          speakerGroup: "Test Group",
          speakerPosition: "Chair"
        },
        {
            speechOrder: 2,
            speaker: "Another Speaker",
            speech: "Speech 2"
        },
        {
          speechOrder: 3,
          speaker: "Third Speaker",
          speech: "Speech 3",
        },
      ]
    });

    // 2. Mock LLM Response (Article with dialogs)
    // Simulating the LLM output which typically contains summaries but lacks precise speaker/original_text info
    const mockDialogs: any = [
      {
        order: 1,
        summary: "Summary of speech 1",
      },
      {
        order: 2,
        summary: "Summary 2",
      },
      {
        order: 3,
        summary: "Summary 3",
        speakerYomi: "Existing Yomi",
        speakerGroup: "Existing Group"
      }
    ];

    // 3. Extract map
    const speakerMap = extractSpeakerMapFromPrompt(mockPrompt);

    // 4. Attach
    const result = attachSpeakerMetadata(mockDialogs, speakerMap);

    // 5. Verify
    
    // Case 1: Metadata attached to empty fields
    expect(result[0].speaker).toBe("Target Speaker");
    expect(result[0].original_text).toBe("This is the original text from prompt.");
    expect(result[0].speakerYomi).toBe("ターゲットスピーカー");
    expect(result[0].speakerGroup).toBe("Test Group");
    expect(result[0].speakerPosition).toBe("Chair");

    // Case 2: Metadata provided, dialog empty
    // Should get data from meta
    expect(result[1].speaker).toBe("Another Speaker");
    expect(result[1].original_text).toBe("Speech 2");

    // Case 3: Metadata present, overwrites hallucinated fields
    expect(result[2].speakerYomi).toBeUndefined();
    expect(result[2].speakerGroup).toBeUndefined();
    expect(result[2].speaker).toBe("Third Speaker");
    expect(result[2].original_text).toBe("Speech 3");
  });

  it("throws when metadata is missing for a dialog order", () => {
    const mockPrompt = JSON.stringify({
      speeches: [{ speechOrder: 1, speaker: "Only One", speech: "Original text" }],
    });
    const speakerMap = extractSpeakerMapFromPrompt(mockPrompt);

    const dialogs: any = [
      { order: 1, summary: "ok" },
      { order: 2, summary: "missing" },
    ];

    expect(() => attachSpeakerMetadata(dialogs, speakerMap)).toThrow("Missing speaker metadata");
  });
});

describe("extractSpeakerMapFromAttachedAssetsPayload", () => {
  it("prefers attached originalText and order fields", () => {
    const payload = JSON.stringify({
      issueID: "TEST-1",
      runId: "RUN-1",
      speeches: [
        {
          order: 10,
          speaker: "From Attached",
          originalText: "Attached original text",
          speech: "Prompt text that should be ignored",
        },
        {
          speechOrder: 20,
          speaker: "Order From SpeechOrder",
          speech: "Fallback text",
          originalText: "Attached original text 2",
          speakerGroup: "Group A",
        },
      ],
    });

    const map = extractSpeakerMapFromAttachedAssetsPayload(payload);
    expect(map.get(10)?.speaker).toBe("From Attached");
    expect(map.get(10)?.originalText).toBe("Attached original text");
    expect(map.get(20)?.speakerGroup).toBe("Group A");
  });
});
