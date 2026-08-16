import React, { useEffect, useMemo, useRef, useState } from "react";

const API =
  import.meta.env.VITE_API_URL ||
  "http://localhost:10000/api";

const DEMO_LOG = `2026-08-15T16:44:01Z INFO [API] GET /health status=200
2026-08-15T16:45:02Z INFO [AuthService] authentication successful
2026-08-15T16:45:31Z WARN [PaymentService] database latency increased
2026-08-15T16:46:02Z ERROR [PaymentService] Connection timeout to PostgreSQL
2026-08-15T16:46:03Z ERROR [PaymentService] Connection timeout to PostgreSQL
2026-08-15T16:46:05Z CRITICAL [CheckoutService] payment dependency unavailable
2026-08-15T16:46:07Z ERROR [API] status=500 POST /checkout
2026-08-15T16:46:10Z ERROR [PaymentService] Connection timeout to PostgreSQL
2026-08-15T16:46:12Z ERROR [PaymentService] Connection timeout to PostgreSQL
2026-08-15T16:47:01Z WARN [API] retry queue increasing
2026-08-15T16:47:22Z ERROR [CheckoutService] payment dependency unavailable
2026-08-15T16:48:01Z INFO [PaymentService] database connection restored
2026-08-15T16:48:08Z INFO [CheckoutService] recovery completed`;

function App() {
  const [token, setToken] =
    useState(localStorage.getItem("loglens_token") || "");

  const [user, setUser] =
    useState(
      JSON.parse(
        localStorage.getItem("loglens_user") || "null"
      )
    );

  const [logs, setLogs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [intelligence, setIntelligence] = useState(null);

  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");

  const [authMode, setAuthMode] =
    useState("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [rawText, setRawText] =
    useState("");

  const [chatInput, setChatInput] =
    useState("");

  const [chat, setChat] = useState([]);

  const [investigation, setInvestigation] =
    useState(null);

  const [tests, setTests] =
    useState([]);

  const [postmortem, setPostmortem] =
    useState(null);

  const [compareBefore, setCompareBefore] =
    useState("");

  const [compareAfter, setCompareAfter] =
    useState("");

  const [comparison, setComparison] =
    useState(null);

  const fileRef = useRef(null);

  const selectedLog = useMemo(
    () =>
      logs.find(
        x => String(x.id) === String(selectedId)
      ),
    [logs, selectedId]
  );

  async function api(
    path,
    options = {}
  ) {
    const headers = {
      ...(options.headers || {})
    };

    if (
      options.body &&
      !(options.body instanceof FormData)
    ) {
      headers["Content-Type"] =
        "application/json";
    }

    if (token) {
      headers.Authorization =
        `Bearer ${token}`;
    }

    const response = await fetch(
      `${API}${path}`,
      {
        ...options,
        headers
      }
    );

    let data = {};

    try {
      data = await response.json();
    } catch {}

    if (!response.ok) {
      throw new Error(
        data.error ||
        `Request failed (${response.status})`
      );
    }

    return data;
  }

  useEffect(() => {
    if (!token) return;

    loadLogs();
  }, [token]);

  useEffect(() => {
    if (!selectedId) return;

    loadSelected(
      selectedId
    );
  }, [selectedId]);

  async function loadLogs() {
    try {
      const data =
        await api("/logs");

      setLogs(
        data.logs || []
      );

      if (
        !selectedId &&
        data.logs?.length
      ) {
        setSelectedId(
          data.logs[0].id
        );
      }
    } catch (e) {
      if (
        e.message.toLowerCase().includes(
          "token"
        )
      ) {
        logout();
      }
    }
  }

  async function loadSelected(id) {
    try {
      setLoading(true);
      setError("");

      const [logData, intelData] =
        await Promise.all([
          api(`/logs/${id}`),
          api(`/intelligence/${id}`)
        ]);

      setSelected(
        logData
      );

      setIntelligence(
        intelData
      );

      const history =
        logData.entries
          ?.filter(
            x =>
              x.level === "ERROR" ||
              x.level === "CRITICAL"
          )
          .slice(-20) || [];

      setChat(
        history.map(
          x => ({
            role: "evidence",
            content:
              `Line ${x.lineNo}: ${x.message}`
          })
        )
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function authenticate() {
    try {
      setLoading(true);
      setError("");

      const data =
        await api(
          authMode === "login"
            ? "/auth/login"
            : "/auth/register",
          {
            method: "POST",
            body: JSON.stringify({
              email,
              password
            })
          }
        );

      localStorage.setItem(
        "loglens_token",
        data.token
      );

      localStorage.setItem(
        "loglens_user",
        JSON.stringify(data.user)
      );

      setToken(data.token);
      setUser(data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem(
      "loglens_token"
    );

    localStorage.removeItem(
      "loglens_user"
    );

    setToken("");
    setUser(null);
    setLogs([]);
    setSelected(null);
    setIntelligence(null);
  }

  async function uploadFile(file) {
    if (!file) return;

    try {
      setLoading(true);
      setError("");

      const form =
        new FormData();

      form.append(
        "file",
        file
      );

      const data =
        await api(
          "/logs/upload",
          {
            method: "POST",
            body: form
          }
        );

      await loadLogs();

      setSelectedId(
        data.id
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function uploadText() {
    if (!rawText.trim()) {
      setError(
        "Paste some logs first."
      );
      return;
    }

    try {
      setLoading(true);
      setError("");

      const data =
        await api(
          "/logs/upload",
          {
            method: "POST",
            body: JSON.stringify({
              text: rawText
            })
          }
        );

      await loadLogs();

      setSelectedId(
        data.id
      );

      setRawText("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDemo() {
    setRawText(
      DEMO_LOG
    );
  }

  async function analyzeAI() {
    if (!selectedId) return;

    try {
      setBusyAction(
        "analyze"
      );

      const data =
        await api(
          `/logs/${selectedId}/analyze`,
          {
            method: "POST"
          }
        );

      setSelected(
        old => ({
          ...old,
          analysis:
            data.analysis
        })
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyAction("");
    }
  }

  async function investigate() {
    if (!selectedId) return;

    try {
      setBusyAction(
        "investigate"
      );

      const data =
        await api(
          `/intelligence/${selectedId}/investigate`,
          {
            method: "POST"
          }
        );

      setInvestigation(
        data.investigation
      );

      setIntelligence(
        data.intelligence
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyAction("");
    }
  }

  async function generateTests() {
    if (!selectedId) return;

    try {
      setBusyAction(
        "tests"
      );

      const data =
        await api(
          `/intelligence/${selectedId}/tests`,
          {
            method: "POST"
          }
        );

      setTests(
        data.tests || []
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyAction("");
    }
  }

  async function generatePostmortem() {
    if (!selectedId) return;

    try {
      setBusyAction(
        "postmortem"
      );

      const data =
        await api(
          `/intelligence/${selectedId}/postmortem`,
          {
            method: "POST"
          }
        );

      setPostmortem(
        data.postmortem
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyAction("");
    }
  }

  async function sendChat() {
    if (
      !selectedId ||
      !chatInput.trim()
    ) {
      return;
    }

    const question =
      chatInput.trim();

    setChatInput("");

    setChat(
      old => [
        ...old,
        {
          role: "user",
          content: question
        }
      ]
    );

    try {
      setBusyAction(
        "chat"
      );

      const data =
        await api(
          `/chat/${selectedId}`,
          {
            method: "POST",
            body: JSON.stringify({
              question
            })
          }
        );

      setChat(
        old => [
          ...old,
          {
            role: "assistant",
            content:
              data.answer
          }
        ]
      );
    } catch (e) {
      setChat(
        old => [
          ...old,
          {
            role: "assistant",
            content:
              `Error: ${e.message}`
          }
        ]
      );
    } finally {
      setBusyAction("");
    }
  }

  async function compareLogs() {
    if (
      !compareBefore ||
      !compareAfter
    ) {
      return;
    }

    try {
      setBusyAction(
        "compare"
      );

      const data =
        await api(
          "/logs/compare",
          {
            method: "POST",
            body: JSON.stringify({
              beforeId:
                Number(
                  compareBefore
                ),
              afterId:
                Number(
                  compareAfter
                )
            })
          }
        );

      setComparison(
        data.comparison
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyAction("");
    }
  }

  async function deleteLog(id) {
    if (
      !window.confirm(
        "Delete this log?"
      )
    ) {
      return;
    }

    try {
      await api(
        `/logs/${id}`,
        {
          method: "DELETE"
        }
      );

      const remaining =
        logs.filter(
          x =>
            String(x.id) !==
            String(id)
        );

      setLogs(
        remaining
      );

      setSelectedId(
        remaining[0]?.id ||
        null
      );

      setSelected(
        null
      );

      setIntelligence(
        null
      );
    } catch (e) {
      setError(e.message);
    }
  }

  if (!token) {
    return (
      <AuthScreen
        mode={authMode}
        setMode={setAuthMode}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        submit={authenticate}
        loading={loading}
        error={error}
      />
    );
  }

  const summary =
    intelligence?.summary ||
    selected?.summary;

  const health =
    summary?.healthScore ?? 0;

  const risk =
    intelligence?.prediction?.level ||
    summary?.incidentRisk ||
    "LOW";

  const riskScore =
    intelligence?.prediction?.score ??
    Math.max(
      0,
      100 - health
    );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            ⚡
          </div>

          <div>
            <strong>
              LogLens
              <span> AI</span>
            </strong>

            <small>
              SRE COMMAND CENTER
            </small>
          </div>
        </div>

        <div className="top-actions">
          <div className="online">
            <i />
            SYSTEM ONLINE
          </div>

          <div className="user-chip">
            {user?.email}
          </div>

          <button
            className="ghost-button"
            onClick={logout}
          >
            Logout
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-title">
            INCIDENTS
          </div>

          <button
            className="new-incident"
            onClick={() => {
              setSelected(null);
              setSelectedId(null);
              setIntelligence(null);
              setRawText("");
            }}
          >
            + New Analysis
          </button>

          <div className="log-list">
            {logs.length === 0 && (
              <div className="empty-side">
                No incidents yet.
              </div>
            )}

            {logs.map(log => (
              <button
                key={log.id}
                className={
                  String(selectedId) ===
                  String(log.id)
                    ? "log-item active"
                    : "log-item"
                }
                onClick={() =>
                  setSelectedId(
                    log.id
                  )
                }
              >
                <div className="log-icon">
                  {log.critical_count > 0
                    ? "🔴"
                    : log.error_count > 0
                      ? "🟠"
                      : "🟢"}
                </div>

                <div className="log-info">
                  <strong>
                    {log.filename}
                  </strong>

                  <span>
                    {log.total_entries || 0}{" "}
                    events
                  </span>
                </div>

                <button
                  className="delete-mini"
                  onClick={e => {
                    e.stopPropagation();
                    deleteLog(
                      log.id
                    );
                  }}
                >
                  ×
                </button>
              </button>
            ))}
          </div>

          <div className="sidebar-bottom">
            <div>
              <span>AI ENGINE</span>
              <strong>
                GEMINI
              </strong>
            </div>

            <div>
              <span>DATABASE</span>
              <strong>
                POSTGRES
              </strong>
            </div>

            <div>
              <span>STATUS</span>
              <strong className="green">
                OPERATIONAL
              </strong>
            </div>
          </div>
        </aside>

        <main className="main">
          <section className="hero">
            <div>
              <div className="eyebrow">
                ◈ AI LOG INTELLIGENCE
              </div>

              <h1>
                Incident
                <span>
                  {" "}
                  Command Center
                </span>
              </h1>

              <p>
                Detect anomalies. Trace root
                causes. Predict failures. Let AI
                investigate your production logs.
              </p>
            </div>

            <div className="hero-badge">
              <span>●</span>
              LLM POWERED
            </div>
          </section>

          {error && (
            <div className="error-banner">
              <span>⚠</span>
              {error}

              <button
                onClick={() =>
                  setError("")
                }
              >
                ×
              </button>
            </div>
          )}

          {!selectedId && (
            <UploadPanel
              rawText={rawText}
              setRawText={setRawText}
              uploadFile={uploadFile}
              uploadText={uploadText}
              loadDemo={loadDemo}
              fileRef={fileRef}
              loading={loading}
            />
          )}

          {selectedId && (
            <>
              <section className="metric-grid">
                <Metric
                  label="SYSTEM HEALTH"
                  value={`${health}`}
                  suffix="/100"
                  icon="♥"
                  tone={
                    health > 70
                      ? "green"
                      : health > 40
                        ? "yellow"
                        : "red"
                  }
                />

                <Metric
                  label="ERROR RATE"
                  value={
                    summary?.errorRate ??
                    0
                  }
                  suffix="%"
                  icon="↯"
                  tone="red"
                />

                <Metric
                  label="INCIDENT RISK"
                  value={risk}
                  icon="◉"
                  tone={
                    risk === "CRITICAL"
                      ? "red"
                      : risk === "HIGH"
                        ? "orange"
                        : "yellow"
                  }
                />

                <Metric
                  label="BLAST RADIUS"
                  value={
                    intelligence
                      ?.blastRadius
                      ?.score ?? 0
                  }
                  suffix="/100"
                  icon="◎"
                  tone="purple"
                />
              </section>

              <section className="command-bar">
                <div>
                  <strong>
                    {selectedLog?.filename}
                  </strong>

                  <span>
                    {summary?.counts?.total ||
                      0}{" "}
                    log events analyzed
                  </span>
                </div>

                <div className="command-actions">
                  <button
                    className="secondary-button"
                    onClick={
                      analyzeAI
                    }
                    disabled={
                      !!busyAction
                    }
                  >
                    {busyAction ===
                    "analyze"
                      ? "Analyzing..."
                      : "🧠 AI Analyze"}
                  </button>

                  <button
                    className="primary-button"
                    onClick={
                      investigate
                    }
                    disabled={
                      !!busyAction
                    }
                  >
                    {busyAction ===
                    "investigate"
                      ? "Investigating..."
                      : "⚡ Investigate"}
                  </button>
                </div>
              </section>

              <section className="dashboard-grid">
                <Panel
                  title="AI INCIDENT VERDICT"
                  subtitle="Autonomous SRE investigation"
                  className="large"
                >
                  {investigation ? (
                    <Investigation
                      data={
                        investigation
                      }
                    />
                  ) : (
                    <div className="investigate-empty">
                      <div className="orb">
                        ✦
                      </div>

                      <h3>
                        Ready for investigation
                      </h3>

                      <p>
                        AI will correlate errors,
                        anomalies, affected services,
                        blast radius and root-cause
                        candidates.
                      </p>

                      <button
                        className="primary-button"
                        onClick={
                          investigate
                        }
                      >
                        ⚡ Start AI Investigation
                      </button>
                    </div>
                  )}
                </Panel>

                <Panel
                  title="FAILURE PREDICTION"
                  subtitle="Risk engine"
                >
                  <Prediction
                    prediction={
                      intelligence
                        ?.prediction
                    }
                    riskScore={
                      riskScore
                    }
                  />
                </Panel>
              </section>

              <section className="dashboard-grid">
                <Panel
                  title="ROOT CAUSE CHAIN"
                  subtitle="Evidence-backed failure categories"
                >
                  <RootCause
                    data={
                      intelligence
                        ?.rootCause
                    }
                  />
                </Panel>

                <Panel
                  title="BLAST RADIUS"
                  subtitle="Potential impact"
                >
                  <BlastRadius
                    data={
                      intelligence
                        ?.blastRadius
                    }
                  />
                </Panel>
              </section>

              <Panel
                title="SERVICE DEPENDENCY MAP"
                subtitle="Detected services and relationships"
              >
                <ServiceGraph
                  graph={
                    intelligence
                      ?.serviceGraph
                  }
                />
              </Panel>

              <section className="dashboard-grid">
                <Panel
                  title="ERROR FINGERPRINTS"
                  subtitle="Normalized recurring failures"
                >
                  <Fingerprints
                    data={
                      intelligence
                        ?.fingerprints
                    }
                  />
                </Panel>

                <Panel
                  title="SECURITY SIGNALS"
                  subtitle="Suspicious patterns detected in logs"
                >
                  <Security
                    data={
                      intelligence
                        ?.security
                    }
                  />
                </Panel>
              </section>

              <Panel
                title="INCIDENT TIMELINE"
                subtitle="Important events reconstructed chronologically"
              >
                <Timeline
                  data={
                    intelligence
                      ?.timeline
                  }
                />
              </Panel>

              <section className="ai-tools">
                <Panel
                  title="AI WAR ROOM"
                  subtitle="Generate engineering artifacts"
                >
                  <div className="war-room-buttons">
                    <button
                      onClick={
                        investigate
                      }
                      className="war-card"
                    >
                      <b>⚡</b>
                      <strong>
                        Investigate
                      </strong>
                      <span>
                        Autonomous incident RCA
                      </span>
                    </button>

                    <button
                      onClick={
                        generateTests
                      }
                      className="war-card"
                    >
                      <b>🧪</b>
                      <strong>
                        Regression Tests
                      </strong>
                      <span>
                        AI-generated test scenarios
                      </span>
                    </button>

                    <button
                      onClick={
                        generatePostmortem
                      }
                      className="war-card"
                    >
                      <b>📝</b>
                      <strong>
                        Postmortem
                      </strong>
                      <span>
                        Production-ready incident report
                      </span>
                    </button>
                  </div>

                  {tests.length > 0 && (
                    <div className="generated-output">
                      <h3>
                        🧪 Generated Regression Tests
                      </h3>

                      {tests.map(
                        (test, index) => (
                          <div
                            className="output-row"
                            key={index}
                          >
                            <span>
                              {index + 1}
                            </span>

                            <p>
                              {test}
                            </p>
                          </div>
                        )
                      )}
                    </div>
                  )}

                  {postmortem && (
                    <div className="generated-output">
                      <h3>
                        📝 AI Postmortem
                      </h3>

                      <pre>
                        {typeof postmortem ===
                        "string"
                          ? postmortem
                          : JSON.stringify(
                              postmortem,
                              null,
                              2
                            )}
                      </pre>
                    </div>
                  )}
                </Panel>
              </section>

              <Panel
                title="LOG REGRESSION LAB"
                subtitle="Compare two production log snapshots"
              >
                <div className="compare-controls">
                  <select
                    value={
                      compareBefore
                    }
                    onChange={e =>
                      setCompareBefore(
                        e.target.value
                      )
                    }
                  >
                    <option value="">
                      Before snapshot
                    </option>

                    {logs.map(log => (
                      <option
                        key={log.id}
                        value={log.id}
                      >
                        {log.filename}
                      </option>
                    ))}
                  </select>

                  <div className="compare-arrow">
                    →
                  </div>

                  <select
                    value={
                      compareAfter
                    }
                    onChange={e =>
                      setCompareAfter(
                        e.target.value
                      )
                    }
                  >
                    <option value="">
                      After snapshot
                    </option>

                    {logs.map(log => (
                      <option
                        key={log.id}
                        value={log.id}
                      >
                        {log.filename}
                      </option>
                    ))}
                  </select>

                  <button
                    className="primary-button"
                    onClick={
                      compareLogs
                    }
                    disabled={
                      busyAction ===
                      "compare"
                    }
                  >
                    {busyAction ===
                    "compare"
                      ? "Comparing..."
                      : "🆚 Compare"}
                  </button>
                </div>

                {comparison && (
                  <Comparison
                    data={
                      comparison
                    }
                  />
                )}
              </Panel>

              <Panel
                title="AI SRE CHAT"
                subtitle="Ask questions using evidence from this incident"
              >
                <div className="chat">
                  <div className="chat-messages">
                    {chat.length === 0 && (
                      <div className="chat-empty">
                        <div>
                          🤖
                        </div>

                        <strong>
                          Ask your logs anything
                        </strong>

                        <span>
                          "What caused the outage?"
                        </span>

                        <span>
                          "Which service failed first?"
                        </span>

                        <span>
                          "What should I fix?"
                        </span>
                      </div>
                    )}

                    {chat.map(
                      (message, index) => (
                        <div
                          key={index}
                          className={
                            message.role ===
                            "user"
                              ? "message user"
                              : message.role ===
                                  "evidence"
                                ? "message evidence"
                                : "message assistant"
                          }
                        >
                          <div className="message-label">
                            {message.role ===
                            "user"
                              ? "YOU"
                              : message.role ===
                                  "evidence"
                                ? "LOG EVIDENCE"
                                : "LOG LENS AI"}
                          </div>

                          <div>
                            {message.content}
                          </div>
                        </div>
                      )
                    )}
                  </div>

                  <div className="chat-input">
                    <input
                      value={
                        chatInput
                      }
                      onChange={e =>
                        setChatInput(
                          e.target.value
                        )
                      }
                      onKeyDown={e => {
                        if (
                          e.key ===
                          "Enter"
                        ) {
                          sendChat();
                        }
                      }}
                      placeholder="Ask: Why did the payment service fail?"
                    />

                    <button
                      onClick={
                        sendChat
                      }
                      disabled={
                        busyAction ===
                        "chat"
                      }
                    >
                      {busyAction ===
                      "chat"
                        ? "..."
                        : "→"}
                    </button>
                  </div>
                </div>
              </Panel>
            </>
          )}
        </main>
      </div>

      {loading && (
        <div className="global-loader">
          <div className="loader-ring" />
          <span>
            Processing logs...
          </span>
        </div>
      )}
    </div>
  );
}

function AuthScreen({
  mode,
  setMode,
  email,
  setEmail,
  password,
  setPassword,
  submit,
  loading,
  error
}) {
  return (
    <div className="auth-screen">
      <div className="auth-background" />

      <div className="auth-card">
        <div className="brand auth-brand">
          <div className="brand-mark">
            ⚡
          </div>

          <div>
            <strong>
              LogLens
              <span> AI</span>
            </strong>

            <small>
              AI INCIDENT COMMAND CENTER
            </small>
          </div>
        </div>

        <h1>
          {mode === "login"
            ? "Welcome back"
            : "Create your command center"}
        </h1>

        <p>
          Investigate production failures with
          AI-powered log intelligence.
        </p>

        {error && (
          <div className="auth-error">
            {error}
          </div>
        )}

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e =>
            setEmail(
              e.target.value
            )
          }
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e =>
            setPassword(
              e.target.value
            )
          }
          onKeyDown={e => {
            if (
              e.key ===
              "Enter"
            ) {
              submit();
            }
          }}
        />

        <button
          className="auth-submit"
          onClick={
            submit
          }
          disabled={loading}
        >
          {loading
            ? "Connecting..."
            : mode === "login"
              ? "Enter Command Center"
              : "Create Account"}
        </button>

        <button
          className="auth-switch"
          onClick={() =>
            setMode(
              mode === "login"
                ? "register"
                : "login"
            )
          }
        >
          {mode === "login"
            ? "Create a new account"
            : "Already have an account? Login"}
        </button>
      </div>
    </div>
  );
}

function UploadPanel({
  rawText,
  setRawText,
  uploadFile,
  uploadText,
  loadDemo,
  fileRef,
  loading
}) {
  return (
    <section className="upload-page">
      <div className="upload-card">
        <div className="upload-icon">
          ↥
        </div>

        <h2>
          Analyze your first incident
        </h2>

        <p>
          Upload production logs or paste them
          directly into the command center.
        </p>

        <button
          className="dropzone"
          onClick={() =>
            fileRef.current?.click()
          }
        >
          <span>
            ☁
          </span>

          <strong>
            Choose a log file
          </strong>

          <small>
            .log .txt .json • Maximum 10 MB
          </small>
        </button>

        <input
          ref={fileRef}
          type="file"
          accept=".log,.txt,.json"
          hidden
          onChange={e =>
            uploadFile(
              e.target.files?.[0]
            )
          }
        />

        <div className="or">
          OR PASTE LOGS
        </div>

        <textarea
          value={rawText}
          onChange={e =>
            setRawText(
              e.target.value
            )
          }
          placeholder="2026-08-15T16:46:02Z ERROR [PaymentService] Connection timeout..."
        />

        <div className="upload-actions">
          <button
            className="secondary-button"
            onClick={
              loadDemo
            }
          >
            ⚡ Load Demo Incident
          </button>

          <button
            className="primary-button"
            onClick={
              uploadText
            }
            disabled={loading}
          >
            {loading
              ? "Uploading..."
              : "Analyze Logs →"}
          </button>
        </div>
      </div>

      <div className="feature-preview">
        <div className="preview-title">
          <span>✦</span>
          WHAT LOG LENS AI DOES
        </div>

        <Feature
          icon="◈"
          title="Error Fingerprinting"
          text="Clusters thousands of similar failures into meaningful incidents."
        />

        <Feature
          icon="◎"
          title="Blast Radius"
          text="Identifies affected services, endpoints and potential impact."
        />

        <Feature
          icon="⌁"
          title="Failure Prediction"
          text="Detects abnormal patterns before they become major incidents."
        />

        <Feature
          icon="⚡"
          title="AI Investigation"
          text="Generates evidence-backed root cause analysis and remediation."
        />

        <Feature
          icon="🧪"
          title="Regression Intelligence"
          text="Generates tests and compares before/after production snapshots."
        />
      </div>
    </section>
  );
}

function Feature({
  icon,
  title,
  text
}) {
  return (
    <div className="feature">
      <div className="feature-icon">
        {icon}
      </div>

      <div>
        <strong>
          {title}
        </strong>

        <p>
          {text}
        </p>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  suffix,
  icon,
  tone
}) {
  return (
    <div className="metric">
      <div
        className={`metric-icon ${tone}`}
      >
        {icon}
      </div>

      <div>
        <span>
          {label}
        </span>

        <strong>
          {value}
          {suffix && (
            <small>
              {suffix}
            </small>
          )}
        </strong>
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
  className = ""
}) {
  return (
    <section
      className={`panel ${className}`}
    >
      <div className="panel-header">
        <div>
          <h2>
            {title}
          </h2>

          <span>
            {subtitle}
          </span>
        </div>

        <div className="panel-dot">
          ●
        </div>
      </div>

      {children}
    </section>
  );
}

function Investigation({
  data
}) {
  return (
    <div className="investigation">
      <div className="verdict">
        <span>
          VERDICT
        </span>

        <strong>
          {data.verdict}
        </strong>

        <small>
          Confidence{" "}
          {Math.round(
            (data.confidence ||
              0) * 100
          )}
          %
        </small>
      </div>

      <div className="investigation-text">
        <h3>
          {data.rootCause}
        </h3>

        <p>
          {data.investigation}
        </p>
      </div>

      <div className="action-columns">
        <div>
          <h4>
            FIX NOW
          </h4>

          {(data.actions ||
            []).map(
            (item, index) => (
              <div
                className="check-row"
                key={index}
              >
                <span>
                  {index + 1}
                </span>

                {item}
              </div>
            )
          )}
        </div>

        <div>
          <h4>
            VERIFY
          </h4>

          {(data.verification ||
            []).map(
            (item, index) => (
              <div
                className="check-row"
                key={index}
              >
                ✓ {item}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function Prediction({
  prediction,
  riskScore
}) {
  return (
    <div className="prediction">
      <div className="risk-number">
        <strong>
          {riskScore}
        </strong>

        <span>
          /100
        </span>
      </div>

      <div
        className="risk-bar"
      >
        <i
          style={{
            width: `${Math.min(
              100,
              riskScore
            )}%`
          }}
        />
      </div>

      <div className="risk-level">
        <span>
          RISK LEVEL
        </span>

        <strong>
          {prediction?.level ||
            "LOW"}
        </strong>
      </div>

      <div className="reasons">
        {(
          prediction?.reasons ||
          []
        ).map(
          (reason, index) => (
            <div
              key={index}
            >
              ⚠ {reason}
            </div>
          )
        )}

        {!prediction?.reasons
          ?.length && (
          <div className="muted">
            No significant failure
            signals detected.
          </div>
        )}
      </div>
    </div>
  );
}

function RootCause({
  data
}) {
  if (!data?.length) {
    return (
      <Empty text="No root-cause category detected yet." />
    );
  }

  return (
    <div className="root-chain">
      {data.map(
        (item, index) => (
          <React.Fragment
            key={item.category}
          >
            <div className="root-node">
              <div>
                {index + 1}
              </div>

              <strong>
                {item.category}
              </strong>

              <span>
                {item.occurrences} signals
              </span>

              <small>
                {item.services
                  ?.join(", ") ||
                  "Service unknown"}
              </small>
            </div>

            {index <
              data.length - 1 && (
              <div className="chain-arrow">
                ↓
              </div>
            )}
          </React.Fragment>
        )
      )}
    </div>
  );
}

function BlastRadius({
  data
}) {
  const score =
    data?.score || 0;

  return (
    <div className="blast">
      <div
        className="blast-circle"
        style={{
          "--score":
            `${score * 3.6}deg`
        }}
      >
        <strong>
          {score}
        </strong>

        <span>
          /100
        </span>
      </div>

      <div>
        <div className="blast-level">
          {data?.severity ||
            "LOW"}
        </div>

        <p>
          {data?.affectedServices
            ?.length || 0}{" "}
          services affected
        </p>

        <p>
          {data?.affectedEndpoints
            ?.length || 0}{" "}
          endpoints detected
        </p>
      </div>
    </div>
  );
}

function ServiceGraph({
  graph
}) {
  if (
    !graph?.nodes?.length
  ) {
    return (
      <Empty text="Service relationships will appear here after log analysis." />
    );
  }

  return (
    <div className="service-graph">
      <div className="graph-grid" />

      <div className="service-nodes">
        {graph.nodes.map(
          node => (
            <div
              key={node.id}
              className={
                node.errors > 0
                  ? "service-node danger"
                  : "service-node"
              }
            >
              <div className="service-status">
                {node.errors > 0
                  ? "●"
                  : "●"}
              </div>

              <strong>
                {node.id}
              </strong>

              <span>
                {node.events} events
              </span>

              <small>
                {node.errors} errors
              </small>
            </div>
          )
        )}
      </div>

      {graph.edges?.length >
        0 && (
        <div className="graph-edges">
          {graph.edges.map(
            (edge, index) => (
              <div
                key={index}
                className="edge"
              >
                {edge.source}
                <span>
                  ─────►
                </span>
                {edge.target}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function Fingerprints({
  data
}) {
  if (!data?.length) {
    return (
      <Empty text="No recurring fingerprints detected." />
    );
  }

  return (
    <div className="fingerprints">
      {data
        .slice(0, 8)
        .map(item => (
          <div
            className="fingerprint"
            key={
              item.fingerprint
            }
          >
            <div>
              <strong>
                {item.message}
              </strong>

              <span>
                {item.services
                  ?.join(", ") ||
                  "Unknown service"}
              </span>
            </div>

            <b>
              {item.count}
            </b>
          </div>
        ))}
    </div>
  );
}

function Security({
  data
}) {
  if (!data?.length) {
    return (
      <div className="security-clear">
        <div>
          ✓
        </div>

        <strong>
          No obvious security signals
        </strong>

        <span>
          Local pattern scanner found no
          suspicious indicators.
        </span>
      </div>
    );
  }

  return (
    <div className="security-list">
      {data.map(
        signal => (
          <div
            className="security-item"
            key={signal.type}
          >
            <div className="security-icon">
              !
            </div>

            <div>
              <strong>
                {signal.type}
              </strong>

              <span>
                {signal.count} occurrence(s)
              </span>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function Timeline({
  data
}) {
  if (!data?.length) {
    return (
      <Empty text="No incident timeline available." />
    );
  }

  return (
    <div className="timeline">
      {data
        .slice(0, 30)
        .map(
          (event, index) => (
            <div
              className="timeline-row"
              key={index}
            >
              <div className="timeline-time">
                {event.timestamp ||
                  `Line ${event.lineNo}`}
              </div>

              <div
                className={`timeline-dot ${String(
                  event.type
                ).toLowerCase()}`}
              />

              <div className="timeline-content">
                <div>
                  <span>
                    {event.type}
                  </span>

                  {event.service && (
                    <b>
                      {event.service}
                    </b>
                  )}
                </div>

                <p>
                  {event.message}
                </p>
              </div>
            </div>
          )
        )}
    </div>
  );
}

function Comparison({
  data
}) {
  return (
    <div className="comparison">
      <div
        className={
          data.regression
            ? "regression danger"
            : "regression safe"
        }
      >
        <strong>
          {data.regression
            ? "⚠ REGRESSION DETECTED"
            : "✓ NO REGRESSION DETECTED"}
        </strong>

        <span>
          Health delta:{" "}
          {data.healthDelta > 0
            ? "+"
            : ""}
          {data.healthDelta}
        </span>
      </div>

      <div className="compare-grid">
        <div>
          <span>
            ERROR DELTA
          </span>

          <strong>
            {data.errorDelta > 0
              ? "+"
              : ""}
            {data.errorDelta}
          </strong>
        </div>

        <div>
          <span>
            WARNING DELTA
          </span>

          <strong>
            {data.warningDelta > 0
              ? "+"
              : ""}
            {data.warningDelta}
          </strong>
        </div>

        <div>
          <span>
            NEW ERROR TYPES
          </span>

          <strong>
            {data.newErrors
              ?.length || 0}
          </strong>
        </div>
      </div>

      {data.newErrors
        ?.length > 0 && (
        <div className="new-errors">
          {data.newErrors.map(
            error => (
              <div
                key={
                  error.fingerprint
                }
              >
                <b>
                  {error.count}×
                </b>

                {error.message}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function Empty({
  text
}) {
  return (
    <div className="empty-panel">
      <span>
        ◌
      </span>

      {text}
    </div>
  );
}

export default App;