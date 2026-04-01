import { invoke } from "@tauri-apps/api/core";
import { useAction, useMutation, useQuery } from "convex/react";
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";

type RuntimeSnapshot = {
  active: boolean;
  operatorId: string | null;
  tier: "Probation" | "Analyst" | "Senior" | null;
  activeSessionSeconds: number;
  accuracyIndex: number;
  systemResourceUtilization: number;
  workStreamGb: number;
  todayApproved: number;
  todayRejected: number;
  statusLine: string;
};

type DashboardProps = {
  operatorEmail: string;
};

type QueueTask = {
  _id: string;
  title: string;
  summary: string;
  batchCode: string;
  region: string;
  sourceModel: string;
  payoutCents: number;
  signals: string[];
};

type AdminCountry = {
  countryCode: string;
  users: number;
  projectedRevenueCents: number;
};

type AiRun = {
  _id: string;
  countryCode: string;
  startedAt: number;
  reviewedCount: number;
  approvedCount: number;
  rejectedCount: number;
  status: string;
};

const shellMetrics = [
  { label: "Precision", value: "99.14%" },
  { label: "Queue Pressure", value: "31 OPEN" },
  { label: "Review SLA", value: "04:12" },
];

const auditFallback = [
  "[14:02] BATCH_771 SYNCED",
  "[14:06] LEDGER_DELTA COMMITTED",
  "[14:11] REVIEW WINDOW REFRESHED",
  "[14:14] STREAM_04 NORMALIZED",
];

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export function Dashboard({ operatorEmail }: DashboardProps) {
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("NG");
  const [runtime, setRuntime] = useState<RuntimeSnapshot>({
    active: false,
    operatorId: null,
    tier: "Analyst",
    activeSessionSeconds: 0,
    accuracyIndex: 99.14,
    systemResourceUtilization: 0,
    workStreamGb: 0,
    todayApproved: 0,
    todayRejected: 0,
    statusLine: "IDLE",
  });
  const [busy, setBusy] = useState(false);
  const deferredSearch = useDeferredValue(search);

  const viewer = useQuery(api.users.current, { email: operatorEmail });
  const reviewQueue = useQuery(api.tasks.reviewQueue, {
    email: operatorEmail,
    countryCode: isAdminEmail(operatorEmail) ? countryFilter : undefined,
  });
  const auditLog = useQuery(api.sessions.auditFeed, { email: operatorEmail });
  const adminOverview = useQuery(api.admin.overview, { email: operatorEmail });
  const latestAiRuns = useQuery(api.admin.latestAiReviewRuns, { email: operatorEmail });

  const ensureUser = useMutation(api.users.ensureUser);
  const acceptTerms = useMutation(api.users.acceptTerms);
  const grantResourceConsent = useMutation(api.users.grantResourceConsent);
  const startShift = useMutation(api.sessions.startShift);
  const stopShift = useMutation(api.sessions.stopShift);
  const approveTask = useMutation(api.tasks.approveTask);
  const rejectTask = useMutation(api.tasks.rejectTask);
  const seedTasks = useMutation(api.tasks.seedTaskBatch);
  const upsertCountryPolicy = useMutation(api.admin.upsertCountryPolicy);
  const generateTaskBatch = useAction(api.tasks.generateTaskBatch);
  const runCountryAiReview = useAction(api.tasks.runCountryAiReview);

  useEffect(() => {
    void ensureUser({ email: operatorEmail });
  }, [ensureUser, operatorEmail]);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const snapshot = await invoke<RuntimeSnapshot>("get_runtime_snapshot");
      if (!cancelled) {
        setRuntime(snapshot);
      }
    };

    void hydrate();
    const interval = window.setInterval(() => {
      void hydrate();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const visibleQueue = useMemo(() => {
    const tasks = reviewQueue ?? [];
    const needle = deferredSearch.trim().toLowerCase();
    if (!needle) return tasks;
    return tasks.filter((task: QueueTask) => {
      return (
        task.batchCode.toLowerCase().includes(needle) ||
        task.title.toLowerCase().includes(needle) ||
        task.region.toLowerCase().includes(needle)
      );
    });
  }, [deferredSearch, reviewQueue]);

  const isAdmin = viewer?.isAdmin ?? isAdminEmail(operatorEmail);

  const handleStartShift = async () => {
    if (!viewer) return;
    setBusy(true);
    try {
      const [session] = await Promise.all([
        startShift({ email: operatorEmail }),
        invoke<RuntimeSnapshot>("start_shift", {
          operatorEmail,
          tier: viewer.tier,
          consentGranted: Boolean(viewer.resourceConsentAt),
        }),
      ]);

      startTransition(() => {
        setRuntime((current) => ({
          ...current,
          active: true,
          operatorId: session.operatorId,
          tier: viewer.tier,
          activeSessionSeconds: 0,
          statusLine: "SHIFT_ACTIVE",
        }));
      });
    } finally {
      setBusy(false);
    }
  };

  const handleStopShift = async () => {
    setBusy(true);
    try {
      await Promise.all([stopShift({ email: operatorEmail }), invoke("stop_shift")]);
      startTransition(() => {
        setRuntime((current) => ({
          ...current,
          active: false,
          statusLine: "SHIFT_PAUSED",
        }));
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDecision = async (taskId: string, decision: "approved" | "rejected", payoutCents: number) => {
    setBusy(true);
    try {
      if (decision === "approved") {
        await approveTask({ taskId: taskId as never, reviewerEmail: operatorEmail });
        await invoke("record_review_outcome", {
          approved: true,
          payoutCents,
          accuracyDelta: 0.12,
        });
      } else {
        await rejectTask({ taskId: taskId as never, reviewerEmail: operatorEmail });
        await invoke("record_review_outcome", {
          approved: false,
          payoutCents: 0,
          accuracyDelta: -0.18,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--ink)] text-[var(--bone)]">
      <div className="mx-auto grid min-h-screen max-w-[1600px] grid-cols-1 gap-px bg-[var(--line)] lg:grid-cols-[248px_minmax(0,1fr)_360px]">
        <aside className="flex flex-col justify-between bg-[var(--panel)] p-5">
          <div className="space-y-8">
            <div className="space-y-2 border border-[var(--line)] px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Qualia Workplace</p>
              <h1 className="text-2xl font-semibold tracking-[-0.06em]">OPERATIONS</h1>
              <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                {viewer?.tier ?? "ANALYST"} NODE
              </p>
            </div>

            <nav className="space-y-2 text-xs uppercase tracking-[0.2em]">
              {["WORK CANVAS", "REVIEW QUEUE", "AUDIT", "BALANCE", isAdmin ? "ADMIN" : "PROFILE"].map((item) => (
                <div key={item} className="border border-[var(--line)] px-3 py-3">
                  {item}
                </div>
              ))}
            </nav>

            <div className="space-y-3 border border-[var(--line)] px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Shift Control</p>
              <button
                type="button"
                onClick={runtime.active ? handleStopShift : handleStartShift}
                disabled={busy || !viewer}
                className="w-full border border-[var(--bone)] px-3 py-3 text-left text-xs uppercase tracking-[0.26em] transition hover:bg-[var(--bone)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:text-[var(--muted)]"
              >
                {runtime.active ? "End Shift" : "Start Shift"}
              </button>
              <button
                type="button"
                onClick={() => void grantResourceConsent({ email: operatorEmail })}
                disabled={busy || Boolean(viewer?.resourceConsentAt)}
                className="w-full border border-[var(--line)] px-3 py-3 text-left text-xs uppercase tracking-[0.26em] text-[var(--muted)] transition hover:border-[var(--bone)] hover:text-[var(--bone)] disabled:cursor-not-allowed disabled:text-[var(--bone)]"
              >
                {viewer?.resourceConsentAt ? "Work Stream Enabled" : "Enable Work Stream Data"}
              </button>
              <button
                type="button"
                onClick={() => void seedTasks({ email: operatorEmail, countryCode: countryFilter })}
                disabled={busy}
                className="w-full border border-[var(--line)] px-3 py-3 text-left text-xs uppercase tracking-[0.26em] text-[var(--muted)] transition hover:border-[var(--bone)] hover:text-[var(--bone)]"
              >
                Pull New Task Batch
              </button>
            </div>
          </div>

          <div className="space-y-3 border border-[var(--line)] px-4 py-4">
            <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Identity</p>
            <p className="text-sm">{operatorEmail}</p>
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
              {viewer?.countryCode ?? "UNMAPPED"} / {viewer?.operatorId ?? "PENDING"}
            </p>
          </div>
        </aside>

        <main className="bg-[var(--surface)]">
          <section className="border-b border-[var(--line)] px-6 py-4">
            <div className="grid gap-px bg-[var(--line)] xl:grid-cols-[1.3fr_repeat(5,minmax(0,1fr))]">
              <div className="bg-[var(--panel)] px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Active Session</p>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.08em]">
                  {formatDuration(runtime.activeSessionSeconds)}
                </p>
              </div>
              <div className="bg-[var(--panel)] px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Accuracy Index</p>
                <p className="mt-2 text-2xl tracking-[-0.06em]">{runtime.accuracyIndex.toFixed(2)}%</p>
              </div>
              <div className="bg-[var(--panel)] px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Balance</p>
                <p className="mt-2 text-2xl tracking-[-0.06em]">{formatCurrency(viewer?.balanceCents ?? 0)}</p>
              </div>
              <div className="bg-[var(--panel)] px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Work Stream Data</p>
                <p className="mt-2 text-2xl tracking-[-0.06em]">{runtime.workStreamGb.toFixed(2)} GB</p>
              </div>
              <div className="bg-[var(--panel)] px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">System Resource Utilization</p>
                <p className="mt-2 text-2xl tracking-[-0.06em]">{runtime.systemResourceUtilization.toFixed(1)}%</p>
              </div>
              <div className="bg-[var(--panel)] px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Review Outcome</p>
                <p className="mt-2 text-2xl tracking-[-0.06em]">
                  {runtime.todayApproved}:{runtime.todayRejected}
                </p>
              </div>
            </div>
          </section>

          <section className="grid gap-px bg-[var(--line)] lg:grid-cols-[1.4fr_0.9fr]">
            <div className="min-h-[calc(100vh-112px)] bg-[var(--surface)]">
              <div className="border-b border-[var(--line)] px-6 py-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Work Canvas</p>
                    <h2 className="mt-1 text-3xl font-semibold tracking-[-0.08em]">Human Verification Surface</h2>
                  </div>
                  <label className="flex min-w-[280px] border border-[var(--line)] bg-[var(--panel)]">
                    <span className="px-3 py-3 text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Filter</span>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.currentTarget.value)}
                      className="w-full bg-transparent px-3 py-3 text-sm outline-none"
                      placeholder="BATCH, REGION, OR TITLE"
                    />
                  </label>
                  {isAdmin ? (
                    <label className="flex min-w-[120px] border border-[var(--line)] bg-[var(--panel)]">
                      <span className="px-3 py-3 text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Country</span>
                      <input
                        value={countryFilter}
                        onChange={(event) => setCountryFilter(event.currentTarget.value.toUpperCase())}
                        className="w-full bg-transparent px-3 py-3 text-sm outline-none"
                        placeholder="NG"
                      />
                    </label>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-px bg-[var(--line)] md:grid-cols-[1.15fr_0.85fr]">
                <div className="space-y-6 bg-[var(--surface)] px-6 py-6">
                  <div className="grid gap-px bg-[var(--line)] sm:grid-cols-3">
                    {shellMetrics.map((metric) => (
                      <div key={metric.label} className="bg-[var(--panel)] px-4 py-4">
                        <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">{metric.label}</p>
                        <p className="mt-2 text-2xl tracking-[-0.06em]">{metric.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3 border border-[var(--line)] p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Incoming Stream</p>
                      <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">{runtime.statusLine}</p>
                    </div>
                    <div className="grid gap-2">
                      {(visibleQueue[0]?.signals ?? [
                        "ENTITY_MATCH SCORE 0.991",
                        "ADDRESS VECTOR PASSED",
                        "TRANSCRIPT EXCEPTION FLAGGED",
                        "TIMESTAMP DRIFT 0.14S",
                      ]).map((line: string) => (
                        <div key={line} className="border border-[var(--line)] px-3 py-3 text-sm tracking-[0.04em]">
                          {line}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3 border border-[var(--line)] p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Review Queue</p>
                      <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                        {visibleQueue.length.toString().padStart(2, "0")} ITEMS
                      </p>
                    </div>

                    <div className="space-y-2">
                      {visibleQueue.map((task: QueueTask) => (
                        <div key={task._id} className="grid gap-3 border border-[var(--line)] px-4 py-4 xl:grid-cols-[minmax(0,1fr)_112px_112px]">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-4">
                              <p className="text-sm font-medium tracking-[0.02em]">{task.title}</p>
                              <span className="text-[10px] uppercase tracking-[0.28em] text-[var(--muted)]">
                                {task.batchCode}
                              </span>
                            </div>
                            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                              {task.region} / {task.sourceModel}
                            </p>
                            <p className="text-sm text-[var(--soft)]">{task.summary}</p>
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleDecision(task._id, "approved", task.payoutCents)}
                            className="border border-[var(--bone)] px-3 py-3 text-xs uppercase tracking-[0.26em] transition hover:bg-[var(--bone)] hover:text-[var(--ink)]"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleDecision(task._id, "rejected", task.payoutCents)}
                            className="border border-[var(--line)] px-3 py-3 text-xs uppercase tracking-[0.26em] text-[var(--muted)] transition hover:border-[var(--bone)] hover:text-[var(--bone)]"
                          >
                            Reject
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-6 bg-[var(--panel)] px-6 py-6">
                  <div className="space-y-3 border border-[var(--line)] p-4">
                    <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Operator Profile</p>
                    <div className="grid gap-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--muted)]">Tier</span>
                        <span>{viewer?.tier ?? "Analyst"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--muted)]">Projected Payout</span>
                        <span>{formatCurrency(viewer?.projectedPayoutCents ?? 0)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--muted)]">Country</span>
                        <span>{viewer?.countryCode ?? "UNMAPPED"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 border border-[var(--line)] p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Console</p>
                      <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Live Audit</p>
                    </div>
                    <div className="space-y-2 font-mono text-[12px]">
                      {(auditLog ?? auditFallback).map((line: string) => (
                        <div key={line} className="border border-[var(--line)] px-3 py-3 text-[var(--soft)]">
                          {line}
                        </div>
                      ))}
                    </div>
                  </div>

                  {isAdmin ? (
                    <div className="space-y-4 border border-[var(--line)] p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Admin Command</p>
                        <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Domain Gate</p>
                      </div>

                      <div className="grid gap-px bg-[var(--line)] sm:grid-cols-3">
                        <div className="bg-[var(--surface)] px-3 py-4">
                          <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Users</p>
                          <p className="mt-2 text-2xl tracking-[-0.06em]">{adminOverview?.userCount ?? 0}</p>
                        </div>
                        <div className="bg-[var(--surface)] px-3 py-4">
                          <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Projected Revenue</p>
                          <p className="mt-2 text-2xl tracking-[-0.06em]">
                            {formatCurrency(adminOverview?.projectedRevenueCents ?? 0)}
                          </p>
                        </div>
                        <div className="bg-[var(--surface)] px-3 py-4">
                          <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Next Budget</p>
                          <p className="mt-2 text-2xl tracking-[-0.06em]">
                            {formatCurrency(adminOverview?.nextPayoutBudgetCents ?? 0)}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {(adminOverview?.topCountries ?? []).map((country: AdminCountry) => (
                          <div key={country.countryCode} className="grid grid-cols-[1fr_auto_auto] gap-3 border border-[var(--line)] px-3 py-3 text-sm">
                            <span>{country.countryCode}</span>
                            <span className="text-[var(--muted)]">{country.users} USERS</span>
                            <span>{formatCurrency(country.projectedRevenueCents)}</span>
                          </div>
                        ))}
                      </div>

                      <div className="grid gap-2 xl:grid-cols-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void (async () => {
                              setBusy(true);
                              try {
                                await upsertCountryPolicy({
                                  email: operatorEmail,
                                  countryCode: countryFilter,
                                  enabled: true,
                                  reviewHourUTC: 23,
                                  reviewMinuteUTC: 0,
                                  autoApproveThreshold: 0.9,
                                  reviewerModel: "meta-llama/llama-4-scout-17b-16e-instruct",
                                });
                              } finally {
                                setBusy(false);
                              }
                            })()
                          }
                          className="border border-[var(--line)] px-3 py-3 text-left text-xs uppercase tracking-[0.26em] text-[var(--muted)] transition hover:border-[var(--bone)] hover:text-[var(--bone)]"
                        >
                          Set EOD AI Review
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void (async () => {
                              setBusy(true);
                              try {
                                await generateTaskBatch({
                                  email: operatorEmail,
                                  countryCode: countryFilter,
                                  count: 4,
                                });
                              } finally {
                                setBusy(false);
                              }
                            })()
                          }
                          className="border border-[var(--bone)] px-3 py-3 text-left text-xs uppercase tracking-[0.26em] transition hover:bg-[var(--bone)] hover:text-[var(--ink)]"
                        >
                          Generate Tasks
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void (async () => {
                              setBusy(true);
                              try {
                                await runCountryAiReview({
                                  email: operatorEmail,
                                  countryCode: countryFilter,
                                });
                              } finally {
                                setBusy(false);
                              }
                            })()
                          }
                          className="border border-[var(--line)] px-3 py-3 text-left text-xs uppercase tracking-[0.26em] text-[var(--muted)] transition hover:border-[var(--bone)] hover:text-[var(--bone)]"
                        >
                          Run AI Review
                        </button>
                      </div>

                      <div className="space-y-2">
                        {(latestAiRuns ?? []).map((run: AiRun) => (
                          <div key={run._id} className="grid grid-cols-[1fr_auto_auto] gap-3 border border-[var(--line)] px-3 py-3 text-sm">
                            <span>{run.countryCode}</span>
                            <span className="text-[var(--muted)]">
                              {run.approvedCount}/{run.rejectedCount}
                            </span>
                            <span>{run.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        </main>

        <aside className="space-y-6 bg-[var(--panel)] p-5">
          <div className="space-y-3 border border-[var(--line)] p-4">
            <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Policy Envelope</p>
            <p className="text-sm text-[var(--soft)]">
              Resource sharing is opt-in and tracked as Work Stream Data. Operators can end utilization at any time by closing an active shift.
            </p>
          </div>

          <div className="space-y-3 border border-[var(--line)] p-4">
            <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Performance Budget</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--muted)]">Client hydration</span>
                <span>&lt; 60ms</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--muted)]">Realtime delta</span>
                <span>&lt; 1s</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--muted)]">Rust command bridge</span>
                <span>ACTIVE</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {viewer && !viewer.termsAcceptedAt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8">
          <div className="max-w-3xl border border-[var(--line)] bg-[var(--panel)] p-8">
            <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Terms And Conditions</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.08em]">Qualia Operator Agreement</h2>
            <div className="mt-5 space-y-4 text-sm leading-6 text-[var(--soft)]">
              <p>
                By activating Qualia, you agree that the application may provide contractor workflow services,
                tasking surfaces, productivity analytics, audit logging, and optional system-resource participation
                features that you expressly enable within the application.
              </p>
              <p>
                You consent to the collection of operational data required to administer tasks, reviews, balances,
                fraud controls, quality monitoring, payout calculations, and country-level program analytics.
              </p>
              <p>
                Optional Work Stream Data participation is disclosed separately and may be disabled by ending your
                shift or withdrawing consent where available. Continued use of the app is also subject to internal
                workplace policy, payment review controls, and regional compliance requirements.
              </p>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => void acceptTerms({ email: operatorEmail })}
                className="border border-[var(--bone)] px-4 py-3 text-xs uppercase tracking-[0.26em] transition hover:bg-[var(--bone)] hover:text-[var(--ink)]"
              >
                Accept And Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function isAdminEmail(email: string) {
  return email.endsWith("@okeymeta.com.ng");
}
