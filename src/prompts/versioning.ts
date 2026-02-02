export type ParsedPromptVersion = {
  major: number;
  minor: number;
  raw: string;
};

export function parsePromptVersion(value?: string): ParsedPromptVersion | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    raw: value,
  };
}

export function isMajorMismatch(current: string, candidate?: string): boolean {
  const currentParsed = parsePromptVersion(current);
  if (!currentParsed) return true;
  const candidateParsed = parsePromptVersion(candidate);
  if (!candidateParsed) return true;
  return currentParsed.major !== candidateParsed.major;
}

export function isMinorMismatch(current: string, candidate?: string): boolean {
  const currentParsed = parsePromptVersion(current);
  if (!currentParsed) return true;
  const candidateParsed = parsePromptVersion(candidate);
  if (!candidateParsed) return true;
  return currentParsed.minor !== candidateParsed.minor;
}
