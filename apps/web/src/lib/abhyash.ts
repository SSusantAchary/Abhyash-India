import type { Speaker } from "./speakers";
export const languages = [
  {
    id: "en-IN",
    name: "Indian English",
    native: "English",
    voice: "Anisha",
    asr: "en-IN",
  },
  {
    id: "hi-IN",
    name: "Hindi",
    native: "हिन्दी",
    voice: "Pooja",
    asr: "hi-IN",
  },
  {
    id: "kn-IN",
    name: "Kannada",
    native: "ಕನ್ನಡ",
    voice: "Pooja",
    asr: "kn-IN",
  },
] as const;

export const scenarios = [
  {
    id: "interview",
    title: "Ace your next interview",
    category: "CAREER",
    description: "Turn your experience into answers that stand out.",
    prompt:
      "Run a realistic job interview. Ask about the learner's role first, then ask one behavioral or situational question at a time. Help structure answers using STAR.",
    icon: "briefcase",
    duration: "4 min practice",
  },
  {
    id: "everyday",
    title: "Find your everyday voice",
    category: "CONVERSATION",
    description: "From a coffee order to a conversation with someone new.",
    prompt:
      "Role-play everyday conversations in India, starting with meeting a new colleague. Help with natural expressions and clear pronunciation.",
    icon: "chat",
    duration: "4 min practice",
  },
  {
    id: "presentation",
    title: "Own the room",
    category: "PUBLIC SPEAKING",
    description: "Make your next presentation clear, calm, and compelling.",
    prompt:
      "Coach a short presentation. Ask the learner for their topic and audience, listen to their opening, then give one specific improvement and invite a retry.",
    icon: "presentation",
    duration: "4 min practice",
  },
  {
    id: "workplace",
    title: "Speak up at work",
    category: "WORKPLACE",
    description: "Practice the meetings and conversations that matter.",
    prompt:
      "Role-play a workplace meeting. Ask the learner about their job, then practice a concise project update and politely expressing a different opinion.",
    icon: "users",
    duration: "4 min practice",
  },
] as const;

export type TranscriptLine = { role: "user" | "assistant"; content: string };
export type PracticeSession = {
  id: string;
  title: string;
  language: string;
  endedAt: string;
  seconds: number;
  transcript: TranscriptLine[];
  speaker?: Speaker;
};
export type ServiceStatus = {
  ready: boolean;
  missing: string[];
  accessCodeRequired: boolean;
  reservedSeconds: number;
  limitSeconds: number;
  active: boolean;
  recoveryRequired: boolean;
  toolsConfigured?: boolean;
};
