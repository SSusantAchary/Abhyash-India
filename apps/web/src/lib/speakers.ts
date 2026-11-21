export type SpeakerGender = "Female" | "Male";
export type Speaker = {
  name: "Pooja" | "Prathamesh" | "Samar" | "Anisha" | "Abhinav";
  gender: SpeakerGender;
  voiceId: string;
};
// Falcon 2.1 catalogue: keep Kannada restricted to supported voices.
export const speakers: readonly (Speaker & { locales: readonly string[] })[] = [
  {
    name: "Pooja",
    gender: "Female",
    voiceId: "Pooja",
    locales: ["en-IN", "hi-IN", "kn-IN"],
  },
  {
    name: "Prathamesh",
    gender: "Male",
    voiceId: "Prathamesh",
    locales: ["en-IN", "hi-IN"],
  },
  {
    name: "Samar",
    gender: "Male",
    voiceId: "Samar",
    locales: ["en-IN", "hi-IN", "kn-IN"],
  },
  {
    name: "Anisha",
    gender: "Female",
    voiceId: "Anisha",
    locales: ["en-IN", "hi-IN"],
  },
  {
    name: "Abhinav",
    gender: "Male",
    voiceId: "Abhinav",
    locales: ["en-IN", "hi-IN"],
  },
];
export function speakersForLanguage(locale: string) {
  return speakers.filter((speaker) => speaker.locales.includes(locale));
}
export function speakerByName(name: string): Speaker | undefined {
  const found = speakers.find((speaker) => speaker.name === name);
  return (
    found && { name: found.name, gender: found.gender, voiceId: found.voiceId }
  );
}
