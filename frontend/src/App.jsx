
import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./App.css";

// Use the actual deployed Render backend in production.
// Set VITE_API_URL in Vercel to override this value.
const defaultApiUrl = import.meta.env.PROD
  ? "https://api-pulse-1.onrender.com"
  : "http://127.0.0.1:8000";

const API = (
  import.meta.env.VITE_API_URL || defaultApiUrl
).replace(/\/+$/, "");

const EMPTY_VALUE = "\u2014";
const HISTORY_LIMIT = 100;
const PAGE_SIZE = 10;

const DEFAULT_URLS = [
  "https://www.google.com",
  "https://www.wikipedia.org",
  "https://www.youtube.com",
  "https://www.amazon.com",
  "https://www.apple.com",
  "https://www.microsoft.com",
  "https://www.netflix.com",
].join("\n");

function App() {
  const [url, setUrl] = useState("https://www.google.com");
  const [batchUrls, setBatchUrls] = useState(DEFAULT_URLS);
  const [result, setResult] = useState(null);
  const [batchResults, setBatchResults] = useState([]);
  const [history, setHistory] = useState([]);
  const [apiState, setApiState] = useState("checking");
  const [loading, setLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyDeleting, setHistoryDeleting] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [page, setPage] = useState(1);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("api-pulse-theme") || "system"
  );

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");

    try {
      const response = await axios.get(`${API}/health/history`, {
        params: { limit: HISTORY_LIMIT },
        timeout: 65000,
      });

      setHistory(
        Array.isArray(response.data.history)
          ? response.data.history
          : []
      );
    } catch {
      setHistoryError(
        "Could not load check history. Check the backend connection and try again."
      );
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const checkApi = useCallback(async () => {
    try {
      await axios.get(`${API}/ready`, { timeout: 65000 });
      setApiState("online");
    } catch {
      setApiState("offline");
    }
  }, []);

  async function deleteHistory() {
    if (
      history.length === 0 ||
      loading ||
      batchLoading ||
      historyDeleting ||
      !window.confirm(
        "Delete all saved check history for everyone? This cannot be undone."
      )
    ) {
      return;
    }

    setHistoryDeleting(true);
    setHistoryError("");

    try {
      await axios.delete(`${API}/health/history`);
      setHistory([]);
      setPage(1);
    } catch (err) {
      setHistoryError(
        err.response?.data?.detail ||
          "Could not delete check history. Try again."
      );
    } finally {
      setHistoryDeleting(false);
    }
  }

  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia(
      "(prefers-color-scheme: dark)"
    );

    const applyTheme = () => {
      root.dataset.theme =
        theme === "system"
          ? mediaQuery.matches
            ? "dark"
            : "light"
          : theme;
    };

    applyTheme();

    try {
      localStorage.setItem("api-pulse-theme", theme);
    } catch {
      // The dashboard still works when storage is unavailable.
    }

    mediaQuery.addEventListener("change", applyTheme);

    return () => {
      mediaQuery.removeEventListener("change", applyTheme);
    };
  }, [theme]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void checkApi();
      void loadHistory();
    }, 0);

    const intervalId = window.setInterval(checkApi, 60000);

    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(intervalId);
    };
  }, [checkApi, loadHistory]);

  function validateUrl(value) {
    try {
      const parsed = new URL(value);
      return (
        ["http:", "https:"].includes(parsed.protocol) &&
        Boolean(parsed.hostname)
      );
    } catch {
      return false;
    }
  }

  async function checkWebsite(event) {
    event.preventDefault();

    const target = url.trim();

    if (!validateUrl(target)) {
      setError(
        "Enter a valid website address beginning with http:// or https://."
      );
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await axios.get(`${API}/health`, {
        params: { url: target },
        timeout: 75000,
      });

      setResult(response.data);
      await Promise.all([loadHistory(), checkApi()]);
    } catch (err) {
      setError(
        err.response?.data?.detail ||
          "Unable to complete the check. The backend may be waking up; wait a moment and retry."
      );

      if (!err.response) {
        await checkApi();
      }
    } finally {
      setLoading(false);
    }
  }

  async function checkBatch(event) {
    event.preventDefault();

    const entries = batchUrls
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    const validUrls = entries.filter(validateUrl);
    const invalidUrls = entries.filter(
      (item) => !validateUrl(item)
    );

    setBatchResults([]);
    setError("");

    if (entries.length === 0) {
      setError("Enter at least one website address to check.");
      return;
    }

    if (entries.length > 10) {
      setError("You can check a maximum of 10 addresses at a time.");
      return;
    }

    if (validUrls.length === 0) {
      setBatchResults(
        invalidUrls.map((invalidUrl) => ({
          url: invalidUrl,
          reachable: false,
          error: "Enter a valid HTTP or HTTPS URL.",
        }))
      );

      setError(
        "None of the entered addresses are valid HTTP or HTTPS URLs."
      );
      return;
    }

    setBatchLoading(true);

    try {
      const response = await axios.post(
        `${API}/health/batch`,
        { urls: validUrls },
        { timeout: 120000 }
      );

      const results = Array.isArray(response.data.results)
        ? response.data.results
        : [];

      let validResultIndex = 0;

      setBatchResults(
        entries.map((entry) => {
          if (!validateUrl(entry)) {
            return {
              url: entry,
              reachable: false,
              error: "Enter a valid HTTP or HTTPS URL.",
            };
          }

          return (
            results[validResultIndex++] || {
              url: entry,
              reachable: false,
              error: "No result was returned for this address.",
            }
          );
        })
      );

      await Promise.all([loadHistory(), checkApi()]);
    } catch (err) {
      setError(
        err.response?.data?.detail ||
          "The batch check could not finish. The backend may be waking up; wait and retry."
      );

      if (!err.response) {
        await checkApi();
      }
    } finally {
      setBatchLoading(false);
    }
  }

  const filteredHistory = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return history
      .filter((item) =>
        normalizedSearch
          ? String(item.url || "")
              .toLowerCase()
              .includes(normalizedSearch)
          : true
      )
      .filter((item) => {
        if (outcomeFilter === "all") return true;
        if (outcomeFilter === "reachable") return item.reachable;
        return !item.reachable;
      })
      .sort((left, right) => {
        if (sortBy === "fastest") {
          return (
            (left.response_time_ms ?? Infinity) -
            (right.response_time_ms ?? Infinity)
          );
        }

        if (sortBy === "slowest") {
          return (
            (right.response_time_ms ?? -Infinity) -
            (left.response_time_ms ?? -Infinity)
          );
        }

        return (
          new Date(right.checked_at || 0) -
          new Date(left.checked_at || 0)
        );
      });
  }, [history, outcomeFilter, search, sortBy]);

  const pageCount = Math.max(
    1,
    Math.ceil(filteredHistory.length / PAGE_SIZE)
  );

  const currentPage = Math.min(page, pageCount);

  const visibleHistory = filteredHistory.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  const successfulHttpCount = history.filter(
    (item) => item.status_code >= 200 && item.status_code < 400
  ).length;

  const failedCount = history.filter(
    (item) =>
      item.status_code == null || item.status_code >= 400
  ).length;

  const timedChecks = history.filter(
    (item) => item.response_time_ms != null
  );

  const averageResponseTime = timedChecks.length
    ? timedChecks.reduce(
        (sum, item) => sum + item.response_time_ms,
        0
      ) / timedChecks.length
    : null;

  const enteredBatchUrls = batchUrls
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const validBatchEntryCount =
    enteredBatchUrls.filter(validateUrl).length;

  const invalidBatchEntryCount =
    enteredBatchUrls.length - validBatchEntryCount;

  function exportHistory() {
    const columns = [
      "URL",
      "Reachable",
      "HTTP status",
      "Response time (ms)",
      "Checked at",
    ];

    const rows = filteredHistory.map((item) => [
      item.url,
      item.reachable ? "Yes" : "No",
      item.status_code ?? "",
      item.response_time_ms ?? "",
      item.checked_at ?? "",
    ]);

    const csv = [columns, ...rows]
      .map((row) =>
        row
          .map((cell) => {
            const text = String(cell ?? "");
            const safeCell = /^[=+\-@]/.test(text.trimStart())
              ? `'${text}`
              : text;

            return `"${safeCell.replaceAll('"', '""')}"`;
          })
          .join(",")
      )
      .join("\r\n");

    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(
      new Blob(["\uFEFF", csv], {
        type: "text/csv;charset=utf-8;",
      })
    );

    link.href = objectUrl;
    link.download = "api-pulse-history.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(
      () => URL.revokeObjectURL(objectUrl),
      1000
    );
  }

  return (
    <main className="dashboard" id="dashboard">
      <a className="skip-link" href="#main-content">
        Skip to dashboard content
      </a>

      <header className="topbar">
        <a
          className="brand"
          href="#dashboard"
          aria-label="API Pulse dashboard"
        >
          <Logo />
          <span className="wordmark">
            <span>API</span> Pulse
          </span>
        </a>

        <nav className="main-nav" aria-label="Main navigation">
          <a href="#dashboard" className="active">
            Dashboard
          </a>
          <a href="#history">History</a>
        </nav>

        <div className="header-actions">
          <button
            className="icon-button"
            type="button"
            onClick={() => {
              void Promise.all([checkApi(), loadHistory()]);
            }}
            disabled={historyLoading}
          >
            {historyLoading ? "Refreshing…" : "Refresh"}
          </button>

          <label className="theme-control">
            <span className="sr-only">Color theme</span>
            <select
              value={theme}
              onChange={(event) => setTheme(event.target.value)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>

          <span className={`api-status ${apiState}`} role="status">
            <span className="status-dot" aria-hidden="true" />
            {apiState === "checking"
              ? "Checking backend…"
              : apiState === "online"
                ? "Backend online"
                : "Backend offline"}
          </span>
        </div>
      </header>

      <div id="main-content" tabIndex="-1">
        <section className="welcome">
          <p className="eyebrow">MONITORING OVERVIEW</p>
          <h1>
            API Pulse <span>Dashboard</span>
          </h1>
          <p>
            Check endpoint availability, understand response health,
            and review recent results.
          </p>
        </section>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="dismiss-button"
              onClick={() => setError("")}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        <section
          className="summary-grid"
          aria-label="Monitoring summary"
        >
          <Metric
            label="Recent checks"
            value={history.length}
            detail={`Last ${HISTORY_LIMIT} saved records`}
            symbol="01"
          />
          <Metric
            label="Healthy HTTP"
            value={successfulHttpCount}
            detail="Responses with status 2xx–3xx"
            symbol="02"
          />
          <Metric
            label="Degraded / failed"
            value={failedCount}
            detail="HTTP 4xx+, or no response"
            symbol="03"
          />
          <Metric
            label="Average response"
            value={
              averageResponseTime == null
                ? EMPTY_VALUE
                : `${Math.round(averageResponseTime)} ms`
            }
            detail="From records with a measured response"
            symbol="04"
          />
        </section>

        <section className="check-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">QUICK TEST</p>
              <h2>Check one website</h2>
              <p className="section-description">
                An HTTP response is shown separately from whether its
                status is successful.
              </p>
            </div>
            <span className="section-icon" aria-hidden="true">
              01
            </span>
          </div>

          <form onSubmit={checkWebsite}>
            <label htmlFor="website-url">Website URL</label>

            <div className="input-row">
              <input
                id="website-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com"
                aria-describedby="website-help"
                required
              />

              <button
                type="submit"
                disabled={loading || historyDeleting}
              >
                {loading && (
                  <span className="button-spinner" aria-hidden="true" />
                )}
                {loading ? "Checking…" : "Check website"}
              </button>
            </div>

            <p className="helper-text" id="website-help">
              Enter a complete URL including https://.
            </p>
          </form>

          {result && (
            <div className="result-panel" aria-live="polite">
              <div className="result-heading">
                <div>
                  <p className="eyebrow">LATEST RESULT</p>
                  <h3>Website report</h3>
                </div>
                <StatusBadge
                  statusCode={result.status_code}
                  reachable={result.reachable}
                />
              </div>

              <p className="result-url">{result.url || url}</p>

              <div className="metrics">
                <Metric
                  label="HTTP response"
                  value={result.reachable ? "Received" : "No response"}
                />
                <Metric
                  label="HTTP status"
                  value={result.status_code ?? EMPTY_VALUE}
                />
                <Metric
                  label="Total response time"
                  value={
                    result.response_time_ms != null
                      ? `${result.response_time_ms} ms`
                      : EMPTY_VALUE
                  }
                />
              </div>

              {result.error && (
                <p className="inline-error">
                  {friendlyError(result.error)}
                </p>
              )}
            </div>
          )}
        </section>

        <section className="check-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">MULTI-SITE TEST</p>
              <h2>Batch website check</h2>
              <p className="section-description">
                Check up to 10 addresses in one request. Each entered
                row receives a result.
              </p>
            </div>
            <span className="section-icon" aria-hidden="true">
              02
            </span>
          </div>

          <form onSubmit={checkBatch}>
            <label htmlFor="batch-urls">
              Website URLs <span className="muted">(maximum 10)</span>
            </label>

            <textarea
              id="batch-urls"
              rows={5}
              value={batchUrls}
              onChange={(event) => setBatchUrls(event.target.value)}
              placeholder={"https://example.com\nhttps://www.google.com"}
              aria-describedby="batch-help"
              required
            />

            <p className="helper-text" id="batch-help">
              One URL per line or separated by commas. Invalid entries
              are reported individually.
            </p>

            <p className="helper-text" role="status">
              {validBatchEntryCount} valid, {invalidBatchEntryCount} invalid
              of {enteredBatchUrls.length} entered.
            </p>

            <button
              type="submit"
              disabled={batchLoading || historyDeleting}
            >
              {batchLoading && (
                <span className="button-spinner" aria-hidden="true" />
              )}
              {batchLoading
                ? "Checking websites…"
                : "Check all websites"}
            </button>
          </form>

          {batchResults.length > 0 && (
            <>
              <p className="result-count" role="status">
                {batchResults.filter((item) => item.reachable).length} of{" "}
                {batchResults.length} returned an HTTP response
              </p>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Website</th>
                      <th scope="col">Result</th>
                      <th scope="col">HTTP status</th>
                      <th scope="col">Response time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchResults.map((item, index) => (
                      <tr key={`${item.url}-${index}`}>
                        <td className="website-cell">{item.url}</td>
                        <td>
                          <StatusBadge
                            statusCode={item.status_code}
                            reachable={item.reachable}
                          />
                        </td>
                        <td>{item.status_code ?? EMPTY_VALUE}</td>
                        <td>
                          {item.response_time_ms != null
                            ? `${item.response_time_ms} ms`
                            : EMPTY_VALUE}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <section className="check-card" id="history">
          <div className="section-heading history-heading">
            <div>
              <h2>Check history</h2>
            </div>

            <div className="history-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={exportHistory}
                disabled={filteredHistory.length === 0}
              >
                Export CSV
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={loadHistory}
                disabled={historyLoading || historyDeleting}
              >
                {historyLoading ? "Refreshing…" : "Refresh history"}
              </button>

              <button
                type="button"
                className="secondary-button danger-button"
                onClick={deleteHistory}
                disabled={
                  history.length === 0 ||
                  historyLoading ||
                  historyDeleting ||
                  loading ||
                  batchLoading
                }
              >
                {historyDeleting ? "Deleting…" : "Delete history"}
              </button>
            </div>
          </div>

          <div className="history-filters">
            <label>
              Search URL
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Find a website…"
              />
            </label>

            <label>
              Response
              <select
                value={outcomeFilter}
                onChange={(event) => {
                  setOutcomeFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All responses</option>
                <option value="reachable">HTTP response received</option>
                <option value="unreachable">No response</option>
              </select>
            </label>

            <label>
              Sort by
              <select
                value={sortBy}
                onChange={(event) => {
                  setSortBy(event.target.value);
                  setPage(1);
                }}
              >
                <option value="newest">Newest first</option>
                <option value="fastest">Fastest response</option>
                <option value="slowest">Slowest response</option>
              </select>
            </label>
          </div>

          {historyError ? (
            <div className="error-banner" role="alert">
              <span>{historyError}</span>
              <button
                type="button"
                className="secondary-button"
                onClick={loadHistory}
                disabled={historyLoading}
              >
                Try again
              </button>
            </div>
          ) : historyLoading && history.length === 0 ? (
            <p className="empty-state" role="status">
              Loading saved checks…
            </p>
          ) : filteredHistory.length === 0 ? (
            <p className="empty-state">
              {history.length > 0
                ? "No checks match these filters."
                : "No saved checks yet. Run a website check to get started."}
            </p>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Website</th>
                      <th scope="col">Result</th>
                      <th scope="col">HTTP status</th>
                      <th scope="col">Response time</th>
                      <th scope="col">Checked at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleHistory.map((item, index) => (
                      <tr key={item.id ?? `${item.url}-${index}`}>
                        <td className="website-cell">{item.url}</td>
                        <td>
                          <StatusBadge
                            statusCode={item.status_code}
                            reachable={item.reachable}
                          />
                        </td>
                        <td>{item.status_code ?? EMPTY_VALUE}</td>
                        <td>
                          {item.response_time_ms != null
                            ? `${item.response_time_ms} ms`
                            : EMPTY_VALUE}
                        </td>
                        <td>{formatDate(item.checked_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="pagination" aria-label="History pagination">
                <span>
                  Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                  {Math.min(
                    currentPage * PAGE_SIZE,
                    filteredHistory.length
                  )}{" "}
                  of {filteredHistory.length}
                </span>

                <div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
                    disabled={currentPage <= 1}
                  >
                    Previous
                  </button>

                  <span aria-live="polite">
                    Page {currentPage} of {pageCount}
                  </span>

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      setPage((current) =>
                        Math.min(pageCount, current + 1)
                      )
                    }
                    disabled={currentPage >= pageCount}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      <footer>
        <span className="footer-brand">
          <Logo /> API Pulse
        </span>
        <span>Live checks · Real saved results · No scheduled monitoring</span>
      </footer>
    </main>
  );
}

function Logo() {
  return (
    <svg
      className="logo-mark"
      viewBox="0 0 48 48"
      role="img"
      aria-label="API Pulse"
    >
      <rect width="48" height="48" rx="12" fill="var(--brand-ink)" />
      <path
        d="M7 26h8l4-10 7 20 5-14 2 4h8"
        fill="none"
        stroke="var(--brand-pulse)"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="41" cy="26" r="3" fill="var(--brand-pulse)" />
    </svg>
  );
}

function Metric({ label, value, detail, symbol }) {
  return (
    <div className="metric-card">
      <div className="metric-topline">
        <span className="metric-label">{label}</span>
        {symbol && <span className="metric-symbol">{symbol}</span>}
      </div>
      <strong className="metric-value">{value}</strong>
      {detail && <span className="metric-detail">{detail}</span>}
    </div>
  );
}

function StatusBadge({ statusCode, reachable }) {
  const status = getStatus(statusCode, reachable);

  return (
    <span className={`table-status ${status.tone}`}>
      <span aria-hidden="true">{status.icon}</span>
      {status.label}
    </span>
  );
}

function getStatus(statusCode, reachable) {
  if (!reachable || statusCode == null) {
    return {
      tone: "unknown",
      icon: "?",
      label: "No response",
    };
  }

  if (statusCode >= 500) {
    return {
      tone: "bad",
      icon: "!",
      label: "Down · HTTP error",
    };
  }

  if (statusCode >= 400) {
    return {
      tone: "degraded",
      icon: "!",
      label: "Degraded · HTTP error",
    };
  }

  if (statusCode >= 200 && statusCode < 400) {
    return {
      tone: "good",
      icon: "✓",
      label: "Healthy · HTTP response",
    };
  }

  return {
    tone: "degraded",
    icon: "!",
    label: "Degraded · HTTP response",
  };
}

function friendlyError(message) {
  if (/name|dns/i.test(message)) {
    return "The domain could not be found. Check the spelling and try again.";
  }

  if (/timed?\s*out|timeout/i.test(message)) {
    return "The website took too long to respond. Try again later.";
  }

  return "The connection could not be completed. Check the address and try again.";
}

function formatDate(value) {
  if (!value) return EMPTY_VALUE;

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString();
}

export default App;
```
