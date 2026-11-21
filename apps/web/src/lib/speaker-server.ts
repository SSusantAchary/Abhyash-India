import { randomInt } from "node:crypto";
import {
  speakersForLanguage,
  type Speaker,
  type SpeakerGender,
} from "./speakers";
export function chooseSpeaker(
  locale: string,
  previousGender?: SpeakerGender,
): Speaker {
  const supported = speakersForLanguage(locale);
  const nextGender = previousGender
    ? previousGender === "Female"
      ? "Male"
      : "Female"
    : randomInt(2) === 0
      ? "Female"
      : "Male";
  const candidates = supported.filter(
    (speaker) => speaker.gender === nextGender,
  );
  if (!candidates.length)
    throw new Error("No supported practice partner for this language.");
  const selected = candidates[randomInt(candidates.length)];
  return {
    name: selected.name,
    gender: selected.gender,
    voiceId: selected.voiceId,
  };
}
