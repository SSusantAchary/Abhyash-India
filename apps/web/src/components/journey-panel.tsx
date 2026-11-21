"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  defaultProfile,
  type JourneyRun,
  type JourneySnapshot,
  type LearnerProfile,
} from "@/lib/journey";
import styles from "./journey-panel.module.css";

type Props = {
  code: string;
  scenario: string;
  language: string;
  live: boolean;
  disabled: boolean;
  mode: "prepare" | "review";
  preparedRunId: string | null;
  onPrepared: (id: string) => void;
};
export function JourneyPanel({
  code,
  scenario,
  language,
  live,
  disabled,
  mode,
  preparedRunId,
  onPrepared,
}: Props) {
  const [snapshot, setSnapshot] = useState<JourneySnapshot | null>(null);
  const [profile, setProfile] = useState<LearnerProfile>({ ...defaultProfile });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const dirty = useRef(false);
  const loading = useRef(false);
  const revision = useRef(0);
  const load = useCallback(async () => {
    // Strict Mode and polling must not issue concurrent first-visit requests
    // that would each create a different browser identity cookie.
    if (loading.current) return;
    loading.current = true;
    const requestedRevision = revision.current;
    try {
      const response = await fetch("/api/journey", {
        headers: { "x-abhyash-code": code },
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (requestedRevision !== revision.current) return;
      setSnapshot(data);
      if (!dirty.current) setProfile(data.profile);
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Your practice could not be loaded.",
      );
    } finally {
      loading.current = false;
    }
  }, [code]);
  useEffect(() => {
    void load();
    const timer = setInterval(load, live ? 2000 : 7000);
    return () => clearInterval(timer);
  }, [load, live, mode]);
  async function action(body: unknown) {
    revision.current++;
    const response = await fetch("/api/journey", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-abhyash-code": code },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (data.id && data.profile && Array.isArray(data.actions)) {
      setSnapshot((previous) =>
        previous
          ? {
              ...previous,
              profile:
                (body as { action: string }).action === "prepare"
                  ? data.profile
                  : previous.profile,
              runs: [
                data,
                ...previous.runs.filter((item) => item.id !== data.id),
              ],
            }
          : previous,
      );
    }
    return data;
  }
  const change = <K extends keyof LearnerProfile>(
    key: K,
    value: LearnerProfile[K],
  ) => {
    dirty.current = true;
    setProfile((previous) => ({ ...previous, [key]: value }));
  };
  async function prepare() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const run = (await action({
        action: "prepare",
        profile,
        scenario,
        language,
      })) as JourneyRun;
      dirty.current = false;
      onPrepared(run.id);
      setSelectedRun(run.id);
      setMessage(
        "Preparation saved. Your coach can now turn this conversation into a practice plan.",
      );
      await load();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Preparation could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function updateTask(runId: string, taskId: string, completed: boolean) {
    const previous = snapshot;
    setSnapshot((current) =>
      current
        ? {
            ...current,
            runs: current.runs.map((run) =>
              run.id !== runId || !run.plan
                ? run
                : {
                    ...run,
                    plan: {
                      ...run.plan,
                      tasks: run.plan.tasks.map((task) =>
                        task.id === taskId
                          ? {
                              ...task,
                              completedAt: completed
                                ? new Date().toISOString()
                                : undefined,
                            }
                          : task,
                      ),
                    },
                  },
            ),
          }
        : current,
    );
    try {
      await action({ action: "task", runId, taskId, completed });
      await load();
    } catch (failure) {
      setSnapshot(previous);
      setError(
        failure instanceof Error
          ? failure.message
          : "Task could not be updated.",
      );
    }
  }
  async function calendar(runId: string) {
    try {
      const response = await fetch(`/api/journey?calendar=${runId}`, {
        headers: { "x-abhyash-code": code },
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "abhyash-practice.ics";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Calendar download failed.",
      );
    }
  }
  const run =
    snapshot?.runs.find((item) => item.id === (selectedRun || preparedRunId)) ||
    snapshot?.runs[0];
  const outcomes = (item: JourneyRun) => (
    <div className={styles.outcomes}>
      <div className={styles.runHeading}>
        <div>
          <span className={styles.kicker}>
            {item.language} · {item.state}
          </span>
          <h3>{item.profile.goal}</h3>
        </div>
        <span className={styles.permission}>
          <ShieldCheck size={15} />
          Your saved permissions apply
        </span>
      </div>
      {item.feedback ? (
        <div className={styles.feedback}>
          <div>
            <h4>What worked</h4>
            <ul>
              {item.feedback.strengths.map((value, index) => (
                <li key={index}>{value}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4>What to practice</h4>
            <ul>
              {item.feedback.improvements.map((value, index) => (
                <li key={index}>{value}</li>
              ))}
            </ul>
          </div>
          <blockquote>
            “{item.feedback.evidenceQuote}”
            <small>Evidence from your answer</small>
          </blockquote>
        </div>
      ) : (
        <p className={styles.empty}>
          Your coach will save feedback after hearing a real answer. No scores
          or results are generated in advance.
        </p>
      )}
      {item.plan && (
        <div className={styles.plan}>
          <h3>Your three-day practice plan</h3>
          <p>{item.plan.summary}</p>
          {item.plan.tasks.map((task) => (
            <label
              key={task.id}
              className={`${styles.task} ${task.completedAt ? styles.complete : ""}`}
            >
              <input
                type="checkbox"
                checked={Boolean(task.completedAt)}
                onChange={(event) =>
                  updateTask(item.id, task.id, event.target.checked)
                }
              />
              <div>
                <strong>
                  Day {task.day} · {task.title}{" "}
                  <small>{task.minutes} min</small>
                </strong>
                <p>{task.instructions}</p>
              </div>
            </label>
          ))}
        </div>
      )}
      {item.reminder && (
        <div className={styles.reminder}>
          <div>
            <strong>
              {Date.parse(item.reminder.at) <= Date.now()
                ? "Your practice is due"
                : "Next practice"}
            </strong>
            <p>{new Date(item.reminder.at).toLocaleString("en-IN")}</p>
            <small>
              Saved in the app. Download and import the file to add a calendar
              alert.
            </small>
          </div>
          <button onClick={() => calendar(item.id)}>
            <Download size={16} />
            Add to calendar
          </button>
        </div>
      )}
      {item.review && (
        <div className={styles.review}>
          <h4>Human review · {item.review.state}</h4>
          <p>{item.review.reason}</p>
          {item.review.state === "pending" ? (
            <details>
              <summary>Reviewer workspace</summary>
              <p>
                This is an internal review queue. No coach has been contacted
                automatically.
              </p>
              <label>
                Reviewer feedback
                <textarea
                  value={reviewNotes}
                  onChange={(event) => setReviewNotes(event.target.value)}
                  maxLength={1000}
                />
              </label>
              <button
                disabled={!reviewNotes.trim()}
                onClick={async () => {
                  try {
                    await action({
                      action: "resolveReview",
                      runId: item.id,
                      resolution: reviewNotes,
                    });
                    setReviewNotes("");
                    await load();
                  } catch (failure) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : "Review could not be saved.",
                    );
                  }
                }}
              >
                Save human review notes
              </button>
            </details>
          ) : (
            <p>{item.review.resolution}</p>
          )}
        </div>
      )}
      <details
        className={styles.actions}
        open={live || item.actions.length > 0}
      >
        <summary>
          Agent actions ·{" "}
          {item.actions.filter((event) => event.status === "succeeded").length}{" "}
          completed
        </summary>
        <p>These are actual server tool executions, not conversation text.</p>
        {item.actions.length === 0 ? (
          <p>No tools have executed yet.</p>
        ) : (
          <ol>
            {item.actions.map((event, index) => (
              <li
                key={`${event.id}-${index}`}
                className={event.status === "failed" ? styles.failedAction : ""}
              >
                <span>
                  {event.status === "succeeded" ? (
                    <CheckCircle2 size={16} />
                  ) : (
                    "!"
                  )}
                </span>
                <div>
                  <strong>{event.summary}</strong>
                  <small>
                    {event.tool} · {event.origin} · {event.latencyMs} ms ·{" "}
                    {new Date(event.at).toLocaleTimeString("en-IN")}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        )}
      </details>
    </div>
  );
  return (
    <section
      className={styles.panel}
      aria-label={
        mode === "prepare"
          ? "Prepare your practice"
          : "Practice plan and agent actions"
      }
    >
      <div className={styles.heading}>
        <div>
          <span className={styles.kicker}>
            PREPARE · PRACTICE · TAKE ACTION
          </span>
          <h2>
            {mode === "prepare"
              ? "Give your practice a purpose."
              : "Keep your next steps moving."}
          </h2>
          <p>
            {mode === "prepare"
              ? "Save your goal and choose what your coach may do. Your next session remembers your progress."
              : "Review saved feedback, complete your drills, and follow through on the actions your coach took."}
          </p>
        </div>
        <button
          className={styles.refresh}
          onClick={load}
          aria-label="Refresh practice plan"
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {mode === "prepare" && (
        <details open={!preparedRunId && !live} className={styles.preparation}>
          <summary>
            <BookOpen size={17} />
            {preparedRunId
              ? "Preparation saved · edit for your next practice"
              : "Set your goal before you start"}
          </summary>
          <div className={styles.fields}>
            <label>
              Your name <span>optional</span>
              <input
                value={profile.name}
                onChange={(event) => change("name", event.target.value)}
                maxLength={80}
                placeholder="What should your coach call you?"
                disabled={disabled}
              />
            </label>
            <label>
              Target role or situation
              <input
                value={profile.targetRole}
                onChange={(event) => change("targetRole", event.target.value)}
                maxLength={120}
                placeholder="e.g. Software engineer interview"
                disabled={disabled}
              />
            </label>
            <label className={styles.wide}>
              My goal
              <textarea
                value={profile.goal}
                onChange={(event) => change("goal", event.target.value)}
                maxLength={500}
                disabled={disabled}
                placeholder="What would make this practice useful?"
              />
            </label>
            <label>
              How speaking feels today
              <select
                value={profile.level}
                onChange={(event) =>
                  change("level", event.target.value as LearnerProfile["level"])
                }
                disabled={disabled}
              >
                <option value="starting">I’m just getting started</option>
                <option value="practicing">I’m building confidence</option>
                <option value="confident">I’m refining my delivery</option>
              </select>
            </label>
            <label>
              Background <span>optional</span>
              <input
                value={profile.background}
                onChange={(event) => change("background", event.target.value)}
                maxLength={1200}
                placeholder="Experience or topic your coach should know"
                disabled={disabled}
              />
            </label>
          </div>
          <fieldset className={styles.permissions} disabled={disabled}>
            <legend>Actions I authorize during this practice</legend>
            <label>
              <input
                type="checkbox"
                checked={profile.allowPlan}
                onChange={(event) => change("allowPlan", event.target.checked)}
              />
              Save a three-day practice plan based on my answer
            </label>
            <label>
              <input
                type="checkbox"
                checked={profile.allowReminder}
                onChange={(event) =>
                  change("allowReminder", event.target.checked)
                }
              />
              Create an in-app reminder and calendar download
            </label>
            {profile.allowReminder && (
              <label className={styles.reminderInput}>
                My next practice time
                <input
                  type="datetime-local"
                  value={
                    profile.reminderAt
                      ? (() => {
                          const d = new Date(profile.reminderAt);
                          return new Date(
                            d.getTime() - d.getTimezoneOffset() * 60000,
                          )
                            .toISOString()
                            .slice(0, 16);
                        })()
                      : ""
                  }
                  onChange={(event) =>
                    change(
                      "reminderAt",
                      event.target.value
                        ? new Date(event.target.value).toISOString()
                        : "",
                    )
                  }
                  required
                />
              </label>
            )}
            <label>
              <input
                type="checkbox"
                checked={profile.allowReview}
                onChange={(event) =>
                  change("allowReview", event.target.checked)
                }
              />
              Allow an internal human-review request if I need more help
            </label>
          </fieldset>
          <p className={styles.note}>
            Your goal, coaching feedback, plans, and action history are saved on
            this server for this browser. No email or calendar account is
            contacted. Your coach can save feedback from your answers when you
            start.
          </p>
          <button
            className={styles.primary}
            disabled={disabled || busy || !snapshot || !profile.goal.trim()}
            onClick={prepare}
          >
            {busy ? (
              <Loader2 className={styles.spinner} size={17} />
            ) : (
              <ShieldCheck size={17} />
            )}
            Save preparation
          </button>
        </details>
      )}
      {!snapshot?.toolsConfigured && (
        <div className={styles.bridgeNotice}>
          <strong>Enable live agent actions</strong>
          <p>
            In a second terminal, run <code>npm run tools:dev</code>. Keep it
            open during your demonstration. This uses a temporary public
            Cloudflare endpoint for authorized coaching actions. Then refresh
            this panel.
          </p>
        </div>
      )}
      {message && (
        <p className={styles.success} role="status">
          {message}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {mode === "review" && snapshot && snapshot.runs.length > 1 && (
        <label className={styles.runSelect}>
          Practice session
          <select
            value={run?.id || ""}
            onChange={(event) => setSelectedRun(event.target.value)}
          >
            {snapshot.runs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.profile.goal.slice(0, 55)} ·{" "}
                {new Date(item.createdAt).toLocaleString("en-IN")}
              </option>
            ))}
          </select>
        </label>
      )}
      {run && (mode === "review" || live || run.actions.length > 0) ? (
        outcomes(run)
      ) : mode === "review" ? (
        <p className={styles.empty}>
          Your saved feedback, plan, and actions will appear here after your
          first practice.
        </p>
      ) : null}
    </section>
  );
}
