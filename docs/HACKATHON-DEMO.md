# Abhyash-India: conversation to action

Abhyash-India helps an Indian learner prepare for an interview, practice by voice, and leave with specific feedback, three daily drills, and an optional scheduled follow-up. It is an independent project derived from Speech-Machine.

## Requirement coverage

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Agora real-time conversational AI | Certificate-authenticated RTC microphone publishing/subscription and Agora v2 agent lifecycle, with native ARES and an OpenAI-compatible LLM | Live English RTC input, ASR, coach audio, and agent shutdown passed a 31-second browser test with synthetic learner speech on November 21, 2026. |
| Murf Falcon voice | Agora TTS vendor `murf`, `falcon-2.1`, Anisha for Indian English and Pooja for Hindi/Kannada | Received non-silent remote audio with Murf Falcon configured: 1,438 packets and positive decoded audio energy. Human assessment of expressiveness and Hindi/Kannada pronunciation remains separate. |
| Agentic workflows | Five real HTTPS tools: retrieve learner context, save feedback, create a practice plan, schedule practice, and request internal coach review | Real Agora callbacks saved feedback, created a three-day plan, and scheduled practice. A premature plan call was rejected; the agent recovered and completed the sequence. Context retrieval and human review also have local automated coverage. |
| End-to-end journey | Preparation and explicit permissions; live coaching and action trail; persistent feedback, tasks, completion tracking, calendar export, human review, and memory in the next session | Preparation, persisted outcomes, completion, memory, review, and calendar export have local browser/store coverage. The live run also produced a downloadable calendar event. |
| Working demonstration | A reproducible voice scenario and action/result panel, with a one-command local demo launcher | A real voice-to-tool run passed with synthetic learner audio. Evidence is linked below; local fixtures are labeled separately. A judge-facing human-operated demo can follow the walkthrough. |

## Start locally

```sh
npm install
npm run dev
```

Open http://127.0.0.1:3100. Credentials belong in `apps/web/.env.local`; never commit that file. Preparation, plans, feedback, and tool receipts are stored under the persistent `ABHYASH_DATA_DIR` (default `apps/web/.abhyash`). A random HttpOnly, SameSite browser cookie isolates each learner's records. This is a single-host hackathon identity model, not a replacement for multi-user production authentication.

## Enable agent tool callbacks

Agora needs a public HTTPS endpoint to call tools. A local-only URL cannot receive calls from Agora's servers.

After explicitly approving use of a temporary public Cloudflare tunnel for learner context and action callbacks:

```sh
npm run tools:install
npm run demo
```

`npm run demo` starts or reuses the local app, then starts a Cloudflare Quick Tunnel through a restricted local bridge. Only GET/POST `/api/agent-tools` is forwarded. Other routes, the setup panel, learner API, source files, and environment files are not exposed. POST calls require a random, short-lived, per-session capability. The bridge prints the HTTPS callback URL, and the app discovers it automatically; credentials are not placed in that URL.

Keep this terminal open during the demonstration. Control+C stops the owned processes and removes the temporary callback configuration. The tunnel is a demo dependency, not production hosting. For a deployed, user-approved HTTPS origin, configure `ABHYASH_TOOLS_BASE_URL` instead.

The user-approved temporary tunnel was used for the live verification and then stopped. Only the tool route was accessible; `/api/journey` and `/` returned 404 through the public address. Restart a new bridge for a new demonstration.

## Judge-facing demo: five minutes

1. In Practice studio, choose an interview and Indian English.
2. Save preparation: target role, confidence level, and goal. For example: “Use specific results in my software-engineer interview answers.” Authorize saving a plan. Optionally authorize a reminder and select its time. Human review is optional.
3. Start a voice practice. Use headphones and allow the microphone. Preparation and recent feedback are supplied to the coach; `getLearnerContext` is also available to retrieve saved context during the call.
4. Give a real answer: “In my last project I coordinated three developers. We split the work into milestones and delivered the dashboard one week early.” Ask: “Save feedback on that answer and create my three-day practice plan.”
5. Watch Agent actions show real `saveCoachingFeedback` and `createPracticePlan` results. If a reminder was authorized, request it and watch `schedulePractice` succeed.
6. End practice. Open My practice plan, read the quoted evidence and daily drills, complete one drill, and download the `.ics` file. Import the file in a calendar application to receive that application's alert. The app does not claim direct calendar sync or send email.
7. If human review was authorized, ask for it. Show the pending internal queue and the manual reviewer workspace. No person is contacted automatically.
8. Prepare another session. The coach receives prior feedback and completed drills. The server stores this context across app restarts.

For the multilingual extension, repeat a brief interaction in Hindi or Kannada. Verify recognition and Murf pronunciation with an actual speaker. The local 50-minute reservation guard remains in place; do not use the entire free provider quota for this demonstration.

## Error and trust demonstration

- Without plan permission, `createPracticePlan` returns a real 403 and logs a failed action.
- Scheduling before a plan exists returns 409. The agent should explain what is missing rather than claim success.
- Repeated successful requests with the same tool-call ID return the stored result instead of repeating the action. Changing arguments under the same ID returns 409.
- Capabilities are scoped to one run and expire; ended sessions cannot write more actions.
- Learner cookies cannot retrieve another learner's plans or calendar exports.
- An unreachable callback endpoint is detected before a billable voice session begins.
- Definite Agora validation/auth rejection releases its reservation. Ambiguous starts remain reserved and block further calls until recovery.

## Proof and limits

Use `npm test`, `npm run typecheck`, `npm run build`, and `npm run verify:journey` (with the local app running). The last command never starts a voice call. It verifies preparation, persistence, navigation, action/result display using an explicitly labeled local test fixture, and desktop/mobile layout. Local test screenshots are not evidence of a live Agora tool invocation.

A qualifying live recording should show the microphone interaction, Murf audio, the actual tool execution log, and the saved result together. Real-time speech latency and provider billing are not inferred from reservation minutes. The app's action latency is local server execution time; end-to-end response latency needs a live measurement. The 50-minute limit is an application reservation guard, not an account-wide billing cap.

## Live verification evidence — November 21, 2026

- [Machine-readable live report](../artifacts/live-verification.json)
- [Screenshot of the actual saved outcome](../artifacts/live-agent-outcome.png)
- Input: 16.19 seconds of synthetic English interview speech, injected as microphone audio through the real browser RTC stack. No tool callbacks or outcomes were manually inserted.
- End-to-end test session: 31 seconds. First received non-silent coach audio was observed 1.864 seconds after the start response; this single observation is not a latency benchmark.
- Received audio: 1,438 RTP packets, 66,531 audio payload bytes, and positive decoded audio energy.
- Actual tool sequence: `createPracticePlan` rejected for missing feedback, `saveCoachingFeedback` succeeded, `createPracticePlan` succeeded, `schedulePractice` succeeded.
- Result: evidence-grounded feedback, three model-generated daily tasks, a reminder at the learner-selected time, and a valid calendar export.
- Agent stop confirmed; no active agent remained. The temporary tunnel was closed after the test.
- Reserved allowance: 20 → 25 minutes. This does not mean 25 actual minutes were billed.

The first callback preflight encountered a cold tunnel route and did not start a voice agent or add a reservation. The app now retries the non-billable health probe before attempting a paid session.

The legacy FastAPI recording analytics remain a separate feature. Live agent outcomes persist in the new journey store and are displayed in My practice plan; they are not mirrored into FastAPI's recording tables. This is not a claim of production deployment, multi-user authentication, or human evaluation of voice quality.

To repeat a paid pipeline verification after approving the bridge and checking the remaining allowance, supply an English PCM WAV using `ABHYASH_LIVE_AUDIO` and run `npm run verify:live -- --allow-paid-live-test`. This opt-in script starts a real call and enforces a short verification deadline, with explicit shutdown in its cleanup path.
