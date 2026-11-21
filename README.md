# Abhyash-India

A multilingual voice practice studio for the Agora + Murf hackathon, rebuilt as an independent project from Susant Achary's Speech-Machine. The original project is unchanged.

Practice job interviews, everyday conversations, presentations, and workplace communication with a patient voice coach in Indian English, Hindi, or Kannada.

## Run the voice studio

Requires Node.js 20.19 or newer and npm. No Python, Docker, local models, or database is needed for live voice practice.

```sh
npm install
cp apps/web/.env.example apps/web/.env.local
# Fill the server settings in apps/web/.env.local.
npm run dev
```

Open **http://127.0.0.1:3100**. If `.env.local` already exists, edit it instead of replacing it. The supplied Murf key has been saved in this ignored local file; it is not included in source or the browser bundle.

Required settings:

| Setting | Source |
| --- | --- |
| `AGORA_APP_ID` | Agora project with Conversational AI enabled |
| `AGORA_APP_CERTIFICATE` | The same project's App Certificate; enable certificate-based RTC authentication |
| `AGORA_CUSTOMER_ID` | Agora REST customer ID |
| `AGORA_CUSTOMER_SECRET` | Agora REST customer secret |
| `MURF_API_KEY` | Murf API key |
| `ABHYASH_ACCESS_CODE` | Choose a strong private demo code; required in production |

Built-in ARES speech recognition and Agora-managed OpenAI `gpt-4o-mini` are used by default. ARES uses its native configuration without a `credential_mode` override, because some Agora project SKUs reject managed ARES. Enable managed model access for the project. Alternatively set `LLM_API_KEY`, `LLM_BASE_URL` (full chat completions endpoint), and `LLM_MODEL` for an OpenAI-compatible provider. Murf uses `falcon-2.1`, Anisha for Indian English and Pooja for Hindi/Kannada. Language selections configure recognition, the coach prompt, and speech output together. A real agent start and immediate stop were verified on November 21, 2026. Microphone conversation, voice output, and pronunciation still need a browser test.

The Connection setup panel reports missing settings without making billable API requests. Agent creation and shutdown have been verified with the configured Agora project. Full spoken conversation is still unverified. Diagnostic agent runs may incur a small amount of actual usage; consult the provider console for billed usage.

## Live session lifecycle

1. The browser requests microphone permission before starting a billable agent.
2. The Node server atomically reserves allowance and generates short-lived, channel-scoped RTC tokens.
3. The server starts an Agora v2 agent, configured with ARES + a language model + Murf.
4. The browser publishes microphone audio through the Agora RTC SDK and plays subscribed coach audio.
5. Completed conversation turns are retrieved from Agora's history endpoint every two seconds.
6. End practice closes the microphone, leaves RTC, and asks the server to stop the agent. A server timer also stops the session at its deadline and retries failed stop requests.

Microphone audio is sent to external providers during live practice. The latest 30 completed conversations are saved in the current browser's local storage. Users can export transcripts as text or delete sessions. Video is not recorded in the voice studio. Recording analytics use the separate inherited backend below.

## 50-minute test allowance

The app permits at most ten 5-minute reservations: each grants a **4-minute practice** with a one-minute connection/cleanup buffer. Early stops and ambiguous startup failures keep their full reservation. Explicit HTTP 400/401/403/404/422 rejections release their reservation because no agent was created. This is deliberately conservative.

- The ledger is stored in `apps/web/.abhyash/usage.json` by default, outside Git. Keep it across restarts. Set `ABHYASH_DATA_DIR` to a persistent directory for a packaged deployment.
- Atomic file locking permits only one active agent on a single host, even with multiple Node workers sharing that directory.
- An uncertain start or failed stop blocks new agents until recovery succeeds.
- RTC privileges expire after 260 seconds. Agora's `idle_timeout` is set to 10 seconds after the subscribed user leaves.
- The browser and server both request shutdown at four minutes. A server outage or provider failure can delay cleanup; this is an application reservation limit, not an Agora account billing cap. Usage in other applications and separate Murf/RTC charges are outside this ledger. Check the Agora console before the real test and stop well below the requested 50-minute maximum.
- Run on a persistent Node host. Ephemeral/serverless deployments and separate machines without a shared locking filesystem are not supported by this budget implementation.

### Recover a connection

Open Connection setup and select **Recover connection / stop active agent**. Recovery queries only the unique server-generated channel, stops the matching agent, and keeps reserved usage counted. An already stopped agent is cleared only after confirmation from Agora.

If a process crashed while holding `usage.lock`, stop all Abhyash server processes, inspect and stop any remaining agent in the Agora console, then remove only the stale `usage.lock` file from the configured data directory. Restart the server and recover the connection. Do not remove or reset `usage.json`. If an ambiguous start returns no agents, wait one minute after the attempt before retrying recovery. Reservations from older ambiguous attempts remain counted.

## Reused Speech-Machine features

The complete recording and review foundation is included in this independent checkout:

- `/dashboard`: practice analytics, goals, trends, upload and transcription
- `/record`: camera/microphone recording, guided reading, draft recovery, live delivery metrics
- `/session/[id]`: transcript, delivery analysis, coaching and exports
- `/setup`, `/login`, `/signup`: existing backend authentication
- `apps/api`: FastAPI, transcription worker, PostgreSQL/SQLite support, local coaching
- `packages/shared`: shared scoring and types

These features require the optional backend. They do not share authentication with the private demo code used by the live studio.

```sh
cp .env.example .env
# Configure backend secrets and CORS as required.
npm run dev:stack
```

The separate Compose project exposes web on **3100**, API on **8100**, PostgreSQL on **5433**, and Redis on **6380** to avoid the original project's ports. It uses its own named data volumes. The web service loads live keys from `apps/web/.env.local`; configure `ABHYASH_ACCESS_CODE` for its production build.

See `docs/ARCHITECTURE.md` and `docs/local-machine.md` for the inherited recording backend architecture; those documents describe the original runtime and ports.

## Validation

```sh
npm run typecheck
npm test
npm run build
# With the dev server running and a Playwright browser installed:
npm run verify:studio
```

Voice service tests mock every upstream request, including token generation, locale selection, missing configuration, the 50-minute limit, concurrent reservation locking, uncertain startup, ownership, recovery, stop failures, and transcript filtering. They consume no provider minutes.

For production on a persistent Node host:

```sh
npm run build
npm --workspace apps/web run start -- --hostname 127.0.0.1 --port 3100
```

Set `ABHYASH_ACCESS_CODE` first and put an HTTPS reverse proxy in front for remote microphone access. Secrets must remain server-side; never use a `NEXT_PUBLIC_` prefix for provider keys or the App Certificate.

## Hackathon demo

1. Show the three languages and select an interview scenario.
2. Start one short English session; answer a question and ask for one concrete improvement.
3. End the session and export the actual conversation.
4. Repeat briefly in Hindi or Kannada after confirming recognition and voice availability.
5. Show the persistent reserved allowance and the inherited recording analytics.

A two-minute English smoke test followed by one minute each in Hindi and Kannada should establish the core flow well below 50 actual minutes. Keep additional paid tests short and check the remaining reserved allowance before starting.

## Official integration references

- [Agora agent lifecycle](https://docs.agora.io/en/ai/build/start-stop-agent)
- [Agora client/server architecture](https://docs.agora.io/en/ai/build/build-server-client)
- [Murf configuration in Agora](https://docs.agora.io/en/ai/models/tts/murf)
- [ARES recognition](https://docs.agora.io/en/ai/models/asr/ares)
- [Conversation history](https://docs.agora.io/en/api-reference/api-ref/conversational-ai/history)

Built by **Susant Achary**. Derived from Speech-Machine; Apache-2.0 license and notices are preserved in `LICENSE`.
