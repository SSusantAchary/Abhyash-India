import type { Speaker } from "./speakers";
export type LearnerProfile = {
  name: string;
  targetRole: string;
  goal: string;
  background: string;
  level: "starting" | "practicing" | "confident";
  allowPlan: boolean;
  allowReminder: boolean;
  allowReview: boolean;
  reminderAt: string;
};
export const defaultProfile: LearnerProfile = {
  name: "",
  targetRole: "",
  goal: "Give clear, confident interview answers",
  background: "",
  level: "practicing",
  allowPlan: true,
  allowReminder: false,
  allowReview: false,
  reminderAt: "",
};
export type CoachingFeedback = {
  strengths: string[];
  improvements: string[];
  evidenceQuote: string;
  savedAt: string;
};
export type PracticeTask = {
  id: string;
  day: number;
  title: string;
  instructions: string;
  minutes: number;
  completedAt?: string;
};
export type PracticePlan = {
  id: string;
  summary: string;
  tasks: PracticeTask[];
  createdAt: string;
};
export type JourneyAction = {
  id: string;
  tool: string;
  status: "succeeded" | "failed";
  summary: string;
  at: string;
  latencyMs: number;
  origin: "agent" | "learner" | "system";
};
export type ReviewRequest = {
  id: string;
  reason: string;
  state: "pending" | "resolved";
  requestedAt: string;
  resolution?: string;
};
export type JourneyRun = {
  speaker?: Speaker;
  id: string;
  scenario: string;
  language: string;
  profile: LearnerProfile;
  state: "prepared" | "live" | "uncertain" | "completed";
  createdAt: string;
  endedAt?: string;
  feedback?: CoachingFeedback;
  plan?: PracticePlan;
  reminder?: { at: string; createdAt: string };
  review?: ReviewRequest;
  actions: JourneyAction[];
};
export type JourneySnapshot = {
  profile: LearnerProfile;
  runs: JourneyRun[];
  toolsConfigured: boolean;
};
