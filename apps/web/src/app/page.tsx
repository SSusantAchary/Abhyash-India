"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  BookOpen,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  Globe2,
  Headphones,
  History,
  LayoutGrid,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  Presentation,
  Radio,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { IAgoraRTCClient, IMicrophoneAudioTrack } from "agora-rtc-sdk-ng";
import {
  languages,
  scenarios,
  type PracticeSession,
  type ServiceStatus,
  type TranscriptLine,
} from "@/lib/abhyash";
import styles from "./practice.module.css";
import { JourneyPanel } from "@/components/journey-panel";

type Connection = {
  id: string;
  appId: string;
  channel: string;
  uid: number;
  token: string;
  deadline: number;
};
type View = "practice" | "sessions" | "guide" | "plan";
const clock = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(Math.max(0, seconds) % 60)
    .toString()
    .padStart(2, "0")}`;
const scenarioIcons = [BriefcaseBusiness, MessageCircle, Presentation, Users];

export default function PracticePage() {
  const [view, setView] = useState<View>("practice");
  const [language, setLanguage] = useState<string>("en-IN");
  const [scenario, setScenario] = useState<string>("interview");
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [volume, setVolume] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [setup, setSetup] = useState(false);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [preparedRunId, setPreparedRunId] = useState<string | null>(null);
  useEffect(() => {
    setPreparedRunId(null);
  }, [scenario, language]);
  const connection = useRef<Connection | null>(null);
  const client = useRef<IAgoraRTCClient | null>(null);
  const mic = useRef<IMicrophoneAudioTrack | null>(null);
  const lines = useRef<TranscriptLine[]>([]);
  const startedAt = useRef(0);
  const config = useRef({ language, scenario });
  const ending = useRef(false);
  const transcriptBottom = useRef<HTMLDivElement>(null);
  const modal = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!setup) return;
    const previous = document.activeElement as HTMLElement | null;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSetup(false);
      if (event.key !== "Tab") return;
      const focusable = modal.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input, a[href], select",
      );
      if (!focusable?.length) return;
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, [setup]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/voice", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setStatus(data);
      setStatusError("");
    } catch (failure) {
      setStatusError(
        failure instanceof Error ? failure.message : "Connection check failed.",
      );
    }
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("abhyash-sessions") || "[]",
      );
      if (Array.isArray(saved))
        setSessions(
          saved.filter(
            (item) =>
              typeof item?.id === "string" &&
              typeof item.title === "string" &&
              Number.isFinite(item.seconds) &&
              Array.isArray(item.transcript),
          ),
        );
    } catch {
      /* Storage may be disabled. */
    }
    setCode(sessionStorage.getItem("abhyash-code") || "");
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function request(body: unknown) {
    const response = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-abhyash-code": code },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Connection failed.");
    return data;
  }

  const releaseAudio = useCallback(async () => {
    mic.current?.stop();
    mic.current?.close();
    mic.current = null;
    const rtc = client.current;
    client.current = null;
    if (rtc) {
      rtc.removeAllListeners();
      await rtc.leave().catch(() => {});
    }
    setLive(false);
    setVolume(0);
    setMuted(false);
  }, []);

  async function endSession() {
    if (ending.current) return;
    ending.current = true;
    setBusy(true);
    const current = connection.current;
    await releaseAudio();
    if (current) {
      try {
        const response = await fetch(`/api/voice?session=${current.id}`, {
          headers: { "x-abhyash-code": code },
        });
        if (response.ok) {
          const data = await response.json();
          lines.current = data.contents;
          setTranscript(data.contents);
        }
      } catch {
        /* Retain the last successful transcript. */
      }
      try {
        await request({ action: "stop", id: current.id });
        setNotice(
          "Practice complete. Your conversation is saved on this browser.",
        );
      } catch (failure) {
        setError(
          `${failure instanceof Error ? failure.message : "Stop could not be confirmed."} Use Recover connection in setup to confirm the agent has stopped.`,
        );
      }
      const item: PracticeSession = {
        id: current.id,
        title: scenarios.find((s) => s.id === config.current.scenario)!.title,
        language: config.current.language,
        endedAt: new Date().toISOString(),
        seconds: Math.min(
          240,
          Math.round((Date.now() - startedAt.current) / 1000),
        ),
        transcript: lines.current,
      };
      setSessions((previous) => {
        const next = [item, ...previous].slice(0, 30);
        try {
          localStorage.setItem("abhyash-sessions", JSON.stringify(next));
        } catch {
          setNotice(
            "Practice ended. Browser storage is unavailable; export your transcript to keep it.",
          );
        }
        return next;
      });
      connection.current = null;
      setPreparedRunId(null);
    }
    setBusy(false);
    ending.current = false;
    refresh();
  }
  const endRef = useRef(endSession);
  endRef.current = endSession;

  useEffect(() => {
    if (!live) return;
    let polling = false;
    const tick = setInterval(async () => {
      const current = connection.current;
      if (!current || ending.current) return;
      setSeconds(
        Math.max(0, Math.ceil((current.deadline - Date.now()) / 1000)),
      );
      setVolume(mic.current?.getVolumeLevel() || 0);
      if (Date.now() >= current.deadline) {
        void endRef.current();
        return;
      }
      if (polling) return;
      polling = true;
      try {
        const response = await fetch(`/api/voice?session=${current.id}`, {
          headers: { "x-abhyash-code": code },
        });
        if (response.ok) {
          const data = await response.json();
          lines.current = data.contents;
          setTranscript(data.contents);
        } else if (response.status === 410) {
          void endRef.current();
        }
      } catch {
        /* Audio continues through brief transcript interruptions. */
      } finally {
        polling = false;
      }
    }, 2000);
    return () => clearInterval(tick);
  }, [live, code]);

  useEffect(() => {
    transcriptBottom.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [transcript]);
  useEffect(() => {
    const unload = () => {
      mic.current?.close();
      const current = connection.current;
      if (current)
        void fetch("/api/voice", {
          method: "POST",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
            "x-abhyash-code": sessionStorage.getItem("abhyash-code") || "",
          },
          body: JSON.stringify({ action: "stop", id: current.id }),
        });
    };
    window.addEventListener("pagehide", unload);
    return () => {
      window.removeEventListener("pagehide", unload);
      unload();
      void releaseAudio();
    };
  }, [releaseAudio]);

  async function start() {
    if (busy || live) return;
    if (!status?.ready || (status.accessCodeRequired && !code)) {
      setSetup(true);
      return;
    }
    if (!preparedRunId) {
      setError(
        "Save your preparation and action permissions before starting practice.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    lines.current = [];
    setTranscript([]);
    try {
      const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
      AgoraRTC.setLogLevel(3);
      mic.current = await AgoraRTC.createMicrophoneAudioTrack({
        AEC: true,
        ANS: true,
        AGC: true,
      });
      const rtc = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      client.current = rtc;
      rtc.on("user-published", async (user, mediaType) => {
        try {
          await rtc.subscribe(user, mediaType);
          if (mediaType === "audio") user.audioTrack?.play();
        } catch {
          setError(
            "Coach audio could not play. Check your speaker settings and reconnect.",
          );
        }
      });
      rtc.on("connection-state-change", (state) => {
        if (state === "DISCONNECTED" && connection.current && !ending.current) {
          setError(
            "The audio connection ended. Your practice is being stopped.",
          );
          void endRef.current();
        }
      });
      const data = (await request({
        action: "start",
        language,
        scenario,
        runId: preparedRunId,
      })) as Connection;
      connection.current = data;
      config.current = { language, scenario };
      startedAt.current = Date.now();
      await rtc.join(data.appId, data.channel, data.token, data.uid);
      await rtc.publish(mic.current);
      setSeconds(Math.max(0, Math.ceil((data.deadline - Date.now()) / 1000)));
      setLive(true);
    } catch (failure) {
      if (connection.current) {
        await request({ action: "stop", id: connection.current.id }).catch(
          () => {},
        );
        connection.current = null;
      }
      await releaseAudio();
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to connect. Check microphone permissions and Connection setup.",
      );
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function toggleMute() {
    if (!mic.current) return;
    try {
      await mic.current.setMuted(!muted);
      setMuted(!muted);
    } catch {
      setError("Microphone could not be changed. Try ending the session.");
    }
  }
  function download(items: TranscriptLine[], title: string) {
    const blob = new Blob(
      [
        `${title}\nAbhyash-India\n\n${items.map((item) => `${item.role === "user" ? "You" : "Abhyash"}: ${item.content}`).join("\n\n")}`,
      ],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "abhyash-practice.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const chosenLanguage = languages.find((item) => item.id === language)!;
  const chosenScenario = scenarios.find((item) => item.id === scenario)!;
  const practiceMinutes = Math.round(
    sessions.reduce((total, item) => total + item.seconds, 0) / 60,
  );

  return (
    <div className={styles.app}>
      <aside className={styles.sidebar}>
        <Link href="/" className={styles.brand} aria-label="Abhyash-India home">
          <span className={styles.logo}>
            <AudioLines size={25} />
          </span>
          <span>
            abhyash<span className={styles.brandIndia}>INDIA</span>
          </span>
        </Link>
        <div className={styles.workspaceLabel}>YOUR SPEAKING SPACE</div>
        <nav aria-label="Main navigation">
          <button
            aria-label="Practice studio"
            className={
              view === "practice" ? styles.navActive : styles.navButton
            }
            onClick={() => setView("practice")}
          >
            <LayoutGrid size={19} />
            Practice studio
          </button>
          <button
            aria-label="My sessions"
            className={
              view === "sessions" ? styles.navActive : styles.navButton
            }
            onClick={() => setView("sessions")}
          >
            <History size={19} />
            My sessions
            {sessions.length > 0 && (
              <span className={styles.count}>{sessions.length}</span>
            )}
          </button>
          <button
            aria-label="My practice plan"
            className={view === "plan" ? styles.navActive : styles.navButton}
            onClick={() => setView("plan")}
          >
            <BookOpen size={19} />
            My practice plan
          </button>
          <Link href="/dashboard" className={styles.navButton}>
            <Presentation size={19} />
            Recording analytics
          </Link>
          <button
            aria-label="Practice guide"
            className={view === "guide" ? styles.navActive : styles.navButton}
            onClick={() => setView("guide")}
          >
            <BookOpen size={19} />
            Practice guide
          </button>
        </nav>
        <div className={styles.sidebarBottom}>
          <div className={styles.smallCard}>
            <span className={styles.smallCardIcon}>
              <Sparkles size={18} />
            </span>
            <strong>
              A little practice.
              <br />A lot more confidence.
            </strong>
            <p>Your next conversation starts with this one.</p>
          </div>
          <button className={styles.navButton} onClick={() => setSetup(true)}>
            <Settings2 size={18} />
            Connection setup
          </button>
          <div className={styles.profile}>
            <span className={styles.avatar}>Y</span>
            <div>
              <strong>Your practice space</strong>
              <small>Agora × Murf hackathon</small>
            </div>
          </div>
        </div>
      </aside>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <span>
            Practice studio <span className={styles.topbarDivider}>/</span>{" "}
            <strong>
              {view === "plan"
                ? "My practice plan"
                : view === "sessions"
                  ? "My sessions"
                  : view === "guide"
                    ? "Practice guide"
                    : "Your daily dose of confidence"}
            </strong>
          </span>
          <button
            className={styles.helpButton}
            onClick={() => setView("guide")}
          >
            <CircleHelp size={18} />
            <span>How it works</span>
          </button>
        </header>
        <main className={styles.main}>
          <div className={styles.heading}>
            <div>
              <p className={styles.eyebrow}>
                MADE FOR YOUR VOICE. MADE FOR INDIA.
              </p>
              <h1>
                {view === "plan" ? (
                  "Your conversation, turned into progress."
                ) : view === "sessions" ? (
                  "Every conversation counts."
                ) : view === "guide" ? (
                  "Small steps. Stronger voice."
                ) : (
                  <>
                    Find your voice.
                    <br className={styles.mobileBreak} /> Build your confidence.
                  </>
                )}
              </h1>
              <p>
                {view === "plan"
                  ? "Your saved feedback, daily drills, reminders, and completed actions."
                  : view === "sessions"
                    ? "Revisit your practice, keep the feedback, and see how far you’ve come."
                    : view === "guide"
                      ? "A simple routine to make speaking feel a little more natural."
                      : "A safe space to speak, make mistakes, and get a little better. Every day."}
              </p>
            </div>
            <span className={styles.hackathonBadge}>
              <Radio size={15} />
              Agora + Murf
            </span>
          </div>
          {view === "plan" && (
            <JourneyPanel
              code={code}
              scenario={scenario}
              language={language}
              live={live}
              disabled={live || busy}
              mode={view === "plan" ? "review" : "prepare"}
              preparedRunId={preparedRunId}
              onPrepared={setPreparedRunId}
            />
          )}
          {view === "practice" && (
            <>
              <section className={styles.hero}>
                <div className={styles.heroCopy}>
                  <span className={styles.heroPill}>
                    <Sparkles size={14} />
                    YOUR AI PRACTICE PARTNER
                  </span>
                  <h2>
                    Big ambitions.
                    <br />
                    Start with a conversation.
                  </h2>
                  <p>
                    Interview prep, everyday chats, or your next big pitch.
                    <br />
                    Practice out loud, in a language that feels like you.
                  </p>
                  <div className={styles.heroDetails}>
                    <span>
                      <Globe2 size={16} />
                      English, हिन्दी, ಕನ್ನಡ
                    </span>
                    <span>
                      <Headphones size={16} />
                      Real conversations
                    </span>
                  </div>
                </div>
                <div className={styles.heroArt} aria-hidden="true">
                  <span className={styles.orbitOne} />
                  <span className={styles.orbitTwo} />
                  <span className={styles.languageBubbleOne}>नमस्ते</span>
                  <span className={styles.languageBubbleTwo}>ನಮಸ್ಕಾರ</span>
                  <div className={styles.artOrb}>
                    <AudioLines size={71} strokeWidth={1.5} />
                  </div>
                  <span className={styles.languageBubbleThree}>
                    Hello, future you.
                  </span>
                  <span className={styles.sparkOne}>✦</span>
                  <span className={styles.sparkTwo}>✧</span>
                </div>
              </section>
              <section
                className={styles.summary}
                aria-label="Your practice statistics"
              >
                <div>
                  <span className={styles.summaryIcon}>
                    <AudioLines size={20} />
                  </span>
                  <p>
                    <strong>{sessions.length}</strong>
                    <span>conversations practiced</span>
                  </p>
                </div>
                <div>
                  <span className={styles.summaryIcon}>
                    <History size={20} />
                  </span>
                  <p>
                    <strong>
                      {practiceMinutes}
                      <small> min</small>
                    </strong>
                    <span>invested in your voice</span>
                  </p>
                </div>
                <div>
                  <span className={styles.summaryIcon}>
                    <Globe2 size={20} />
                  </span>
                  <p>
                    <strong>
                      3<small> languages</small>
                    </strong>
                    <span>one confident you</span>
                  </p>
                </div>
              </section>
              <JourneyPanel
                code={code}
                scenario={scenario}
                language={language}
                live={live}
                disabled={live || busy}
                mode="prepare"
                preparedRunId={preparedRunId}
                onPrepared={setPreparedRunId}
              />
              <div className={styles.sectionHeading}>
                <div>
                  <h2>What are we practicing today?</h2>
                  <p>
                    Pick a real-life moment. We’ll help you feel ready for it.
                  </p>
                </div>
                <span className={styles.sectionCaption}>
                  A LITTLE BETTER, EVERY DAY
                </span>
              </div>
              <div className={styles.studioGrid}>
                <section
                  className={styles.scenarioGrid}
                  aria-label="Practice scenarios"
                >
                  {scenarios.map((item, index) => {
                    const Icon = scenarioIcons[index];
                    return (
                      <button
                        key={item.id}
                        disabled={live || busy}
                        className={`${styles.scenarioCard} ${scenario === item.id ? styles.scenarioSelected : ""}`}
                        aria-pressed={scenario === item.id}
                        onClick={() => {
                          setScenario(item.id);
                          setNotice("");
                        }}
                      >
                        <div className={styles.scenarioTop}>
                          <span
                            className={`${styles.scenarioIcon} ${styles[`icon${index}`]}`}
                          >
                            <Icon size={23} strokeWidth={1.7} />
                          </span>
                          <span className={styles.radio}>
                            {scenario === item.id && <Check size={12} />}
                          </span>
                        </div>
                        <span className={styles.category}>{item.category}</span>
                        <h3>{item.title}</h3>
                        <p>{item.description}</p>
                        <span className={styles.cardDuration}>
                          <Headphones size={13} />
                          {item.duration}
                        </span>
                      </button>
                    );
                  })}
                </section>
                <section
                  className={styles.coachPanel}
                  aria-label="Live practice controls"
                >
                  <div className={styles.coachHeader}>
                    <span className={styles.coachAvatar}>
                      <AudioLines size={25} />
                    </span>
                    <div>
                      <h2>Meet your practice partner</h2>
                      <p>Patient. Supportive. Always here.</p>
                    </div>
                  </div>
                  <label htmlFor="language" className={styles.fieldLabel}>
                    I’D LIKE TO SPEAK IN
                  </label>
                  <div className={styles.selectWrap}>
                    <Globe2 size={17} />
                    <select
                      id="language"
                      value={language}
                      disabled={live || busy}
                      onChange={(event) => setLanguage(event.target.value)}
                    >
                      {languages.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.native}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={16} />
                  </div>
                  <div
                    className={`${styles.voicePreview} ${live ? styles.voiceLive : ""}`}
                  >
                    <div className={styles.waveform} aria-hidden="true">
                      {Array.from({ length: 29 }, (_, i) => (
                        <span
                          key={i}
                          style={{
                            // Integer CSS values serialize identically in Node and browsers.
                            height: `${Math.round(7 + Math.sin(i * 1.4) ** 2 * (live ? 22 + volume * 50 : 29))}px`,
                            animationDelay: `${i * 65}ms`,
                          }}
                        />
                      ))}
                    </div>
                    <strong>
                      {live
                        ? muted
                          ? "Microphone muted"
                          : "You have the floor."
                        : "Your voice belongs here."}
                    </strong>
                    <span>
                      {live
                        ? `${clock(seconds)} remaining · ${chosenLanguage.name}`
                        : "No judgement. Just progress."}
                    </span>
                  </div>
                  <button
                    className={live ? styles.stopButton : styles.startButton}
                    disabled={busy || (!live && Boolean(status?.active))}
                    onClick={() => (live ? endSession() : start())}
                  >
                    {busy ? (
                      <Loader2 size={18} className={styles.spinner} />
                    ) : live ? (
                      <Square size={15} fill="currentColor" />
                    ) : (
                      <Mic size={18} />
                    )}
                    {busy
                      ? "Connecting…"
                      : live
                        ? "End practice"
                        : "Let’s practice"}
                  </button>
                  {live && (
                    <button className={styles.muteButton} onClick={toggleMute}>
                      {muted ? <MicOff size={16} /> : <Mic size={16} />}
                      {muted ? "Unmute microphone" : "Mute microphone"}
                    </button>
                  )}
                  <p className={styles.privacyNote}>
                    <ShieldCheck size={13} />
                    4-minute session · You’re in control
                  </p>
                  <div className={styles.connectionStatus}>
                    <span
                      className={
                        status?.ready ? styles.readyDot : styles.pendingDot
                      }
                    />
                    <button
                      onClick={() => {
                        refresh();
                        setSetup(true);
                      }}
                    >
                      {statusError
                        ? "Connection check unavailable"
                        : status?.ready
                          ? status.active
                            ? "Session active · manage connection"
                            : "Live services configured"
                          : "Set up your live connection"}
                    </button>
                  </div>
                </section>
              </div>
              {(error || notice) && (
                <div
                  role={error ? "alert" : "status"}
                  className={error ? styles.error : styles.notice}
                >
                  {error || notice}
                  {error && (
                    <button onClick={() => setSetup(true)}>Open setup</button>
                  )}
                </div>
              )}
              {(live || transcript.length > 0) && (
                <section className={styles.transcript}>
                  <div className={styles.sectionHeading}>
                    <div>
                      <h2>
                        {live ? "Your conversation" : "Practice transcript"}
                      </h2>
                      <p>
                        {live
                          ? "Updated as your coach completes each turn."
                          : "Keep a copy of your conversation and coaching feedback."}
                      </p>
                    </div>
                    <button
                      disabled={!transcript.length}
                      className={styles.textButton}
                      onClick={() => download(transcript, chosenScenario.title)}
                    >
                      <Download size={16} />
                      Export
                    </button>
                  </div>
                  <div className={styles.transcriptBody} aria-live="polite">
                    {!transcript.length && (
                      <p className={styles.emptyTranscript}>
                        Say hello. Your conversation will appear here.
                      </p>
                    )}
                    {transcript.map((item, i) => (
                      <div
                        key={i}
                        className={
                          item.role === "user"
                            ? styles.userMessage
                            : styles.coachMessage
                        }
                      >
                        <strong>
                          {item.role === "user" ? "You" : "Abhyash"}
                        </strong>
                        <p>{item.content}</p>
                      </div>
                    ))}
                    <div ref={transcriptBottom} />
                  </div>
                </section>
              )}
              <div className={styles.tip}>
                <span>✦</span>
                <p>
                  <strong>Progress sounds different for everyone.</strong> Don’t
                  aim for perfect. Aim for one more conversation.
                </p>
                <span className={styles.tipNative}>अभ्यास से आत्मविश्वास</span>
              </div>
            </>
          )}
          {view === "sessions" && (
            <section className={styles.historyPanel}>
              {sessions.length === 0 ? (
                <div className={styles.emptyState}>
                  <History size={36} />
                  <h2>Your story starts with one conversation.</h2>
                  <p>
                    Completed voice practices and transcripts will appear here,
                    saved on this browser.
                  </p>
                  <button
                    className={styles.startButton}
                    onClick={() => setView("practice")}
                  >
                    Start your first practice
                  </button>
                </div>
              ) : (
                sessions.map((item) => (
                  <article className={styles.historyItem} key={item.id}>
                    <div>
                      <span className={styles.category}>
                        {languages.find((l) => l.id === item.language)?.name ||
                          item.language}{" "}
                        · {clock(item.seconds)}
                      </span>
                      <h2>{item.title}</h2>
                      <p>{new Date(item.endedAt).toLocaleString("en-IN")}</p>
                      <details>
                        <summary>Read conversation</summary>
                        {item.transcript.length ? (
                          item.transcript.map((line, index) => (
                            <p key={index}>
                              <strong>
                                {line.role === "user" ? "You" : "Abhyash"}:
                              </strong>{" "}
                              {line.content}
                            </p>
                          ))
                        ) : (
                          <p>No transcript was available for this session.</p>
                        )}
                      </details>
                    </div>
                    <div className={styles.historyActions}>
                      <button
                        className={styles.textButton}
                        disabled={!item.transcript.length}
                        onClick={() => download(item.transcript, item.title)}
                      >
                        <Download size={17} />
                        Export
                      </button>
                      <button
                        className={styles.textButton}
                        aria-label={`Delete ${item.title}`}
                        onClick={() => {
                          const next = sessions.filter((s) => s.id !== item.id);
                          try {
                            localStorage.setItem(
                              "abhyash-sessions",
                              JSON.stringify(next),
                            );
                            setSessions(next);
                          } catch {
                            setError("Browser storage could not be updated.");
                          }
                        }}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </article>
                ))
              )}
            </section>
          )}
          {view === "guide" && (
            <section className={styles.guide}>
              <div>
                <span className={styles.guideIcon}>
                  <Globe2 />
                </span>
                <h2>Start where you feel comfortable.</h2>
                <p>
                  Choose English, Hindi, or Kannada. Your coach uses the
                  selected language for both understanding and speaking. You can
                  naturally mix in English.
                </p>
              </div>
              <div>
                <span className={styles.guideIcon}>
                  <Mic />
                </span>
                <h2>Say it out loud.</h2>
                <p>
                  Choose a situation, allow microphone access, and speak as you
                  would in real life. Headphones help your coach hear you
                  clearly. Each practice ends automatically after four minutes.
                </p>
              </div>
              <div>
                <span className={styles.guideIcon}>
                  <Sparkles />
                </span>
                <h2>Try that sentence again.</h2>
                <p>
                  Ask for a specific correction, a stronger example, or a short
                  practice plan. Your coach gives feedback in the conversation.
                  Repeating an answer helps turn advice into a habit.
                </p>
              </div>
              <div>
                <span className={styles.guideIcon}>
                  <ShieldCheck />
                </span>
                <h2>Your practice, your choice.</h2>
                <p>
                  Live audio is processed by Agora, its speech and language
                  providers, and Murf. Transcripts are saved in this browser
                  when you end a practice. Export or delete them from My
                  sessions. For recorded video and delivery analytics, open
                  Recording analytics.
                </p>
              </div>
            </section>
          )}
          <footer className={styles.footer}>
            <span>
              Speak a little. Grow a little. <span>♥</span>
            </span>
            <span>Built in India · Powered by Agora & Murf</span>
          </footer>
        </main>
      </div>
      {setup && (
        <div
          className={styles.modalBackdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget) setSetup(false);
          }}
        >
          <section
            ref={modal}
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="setup-title"
          >
            <button
              autoFocus
              className={styles.closeModal}
              onClick={() => setSetup(false)}
              aria-label="Close connection setup"
            >
              <X size={21} />
            </button>
            <span className={styles.guideIcon}>
              <Settings2 />
            </span>
            <h2 id="setup-title">Your live connection</h2>
            <p>
              Agora carries the conversation. Murf gives your coach a voice.
            </p>
            <div className={styles.providerRows}>
              <div>
                <strong>Agora Conversational AI</strong>
                <span>
                  {status?.missing.some((key) => key.startsWith("AGORA"))
                    ? "Needs configuration"
                    : status
                      ? "Configured"
                      : "Checking"}
                </span>
              </div>
              <div>
                <strong>Murf voice</strong>
                <span>
                  {status?.missing.includes("MURF_API_KEY")
                    ? "Needs API key"
                    : status
                      ? "Configured"
                      : "Checking"}
                </span>
              </div>
            </div>
            {status?.missing.length ? (
              <div className={styles.setupInfo}>
                <strong>Server settings needed</strong>
                <p>
                  Add these to <code>apps/web/.env.local</code>, then restart
                  the web server.
                </p>
                <ul>
                  {status.missing.map((key) => (
                    <li key={key}>
                      <code>{key}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className={styles.setupInfo}>
                Credentials are configured. Connection and model access are
                verified when a real session starts.
              </p>
            )}
            {(status?.accessCodeRequired ||
              status?.missing.includes("ABHYASH_ACCESS_CODE")) && (
              <label className={styles.codeLabel}>
                Demo access code
                <input
                  type="password"
                  autoComplete="off"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value);
                    sessionStorage.setItem("abhyash-code", event.target.value);
                  }}
                  placeholder="Enter the code from your server configuration"
                />
              </label>
            )}
            <div className={styles.budget}>
              <div>
                <strong>Hackathon test allowance</strong>
                <span>
                  {Math.round((status?.reservedSeconds || 0) / 60)} / 50 min
                  reserved
                </span>
              </div>
              <progress max={3000} value={status?.reservedSeconds || 0} />
              <p>
                Each 4-minute practice reserves 5 minutes, including a
                connection and cleanup buffer. The app blocks new calls at 50
                minutes. Unused reservation time stays counted.
              </p>
            </div>
            {(status?.active || status?.recoveryRequired) && (
              <button
                className={styles.recoverButton}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await request({ action: "recover" });
                    await releaseAudio();
                    connection.current = null;
                    setNotice(
                      "Connection recovered. You can start a new practice.",
                    );
                  } catch (failure) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : "Recovery failed.",
                    );
                  } finally {
                    setBusy(false);
                    refresh();
                  }
                }}
              >
                Recover connection / stop active agent
              </button>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {statusError && <p className={styles.error}>{statusError}</p>}
            <button className={styles.startButton} onClick={() => refresh()}>
              Check connection settings
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
