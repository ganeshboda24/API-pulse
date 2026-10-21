
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

const DEFAULT_URLS = [
  "https://example.com",
  "https://www.google.com",
  "https://www.wikipedia.org",
].join("\n");

function App() {
  const [url, setUrl] = useState("https://example.com");
  const [batchUrls, setBatchUrls] = useState(DEFAULT_URLS);
  const [result, setResult] = useState(null);
  const [batchResults, setBatchResults] = useState([]);
  const [history, setHistory] = useState([]);
  const [apiOnline, setApiOnline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);

    try {
      const response = await axios.get(`${API}/health/history`, {
        params: { limit: 20 },
        timeout: 10000,
      });

      setHistory(response.data.history || []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const checkApi = useCallback(async () => {
    try {
      await axios.get(`${API}/`, { timeout: 5000 });
      setApiOnline(true);
    } catch {
      setApiOnline(false);
    }
  }, []);

  useEffect(() => {
    checkApi();
    loadHistory();

    const intervalId = setInterval(checkApi, 10000);

    return () => clearInterval(intervalId);
  }, [checkApi, loadHistory]);

  async function checkWebsite(event) {
    event.preventDefault();

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await axios.get(`${API}/health`, {
        params: { url: url.trim() },
        timeout: 30000,
      });

      setResult(response.data);
      await loadHistory();
    } catch (err) {
      setError(
        err.response?.data?.detail ||
          "Unable to check this website. Confirm that FastAPI is running."
      );
    } finally {
      setLoading(false);
    }
  }

  async function checkBatch(event) {
    event.preventDefault();

    setBatchLoading(true);
    setError("");
    setBatchResults([]);

    const urls = batchUrls
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (urls.length === 0) {
      setError("Please enter at least one website URL.");
      setBatchLoading(false);
      return;
    }

    if (urls.length > 10) {
      setError("You can check a maximum of 10 URLs at a time.");
      setBatchLoading(false);
      return;
    }

    const invalidUrl = urls.find((item) => {
      try {
        const parsed = new URL(item);
        return !["http:", "https:"].includes(parsed.protocol);
      } catch {
        return true;
      }
    });

    if (invalidUrl) {
      setError(`Please enter a valid HTTP or HTTPS URL: ${invalidUrl}`);
      setBatchLoading(false);
      return;
    }

    try {
      const response = await axios.post(
        `${API}/health/batch`,
        { urls },
        { timeout: 60000 }
      );

      setBatchResults(response.data.results || []);
      await loadHistory();
    } catch (err) {
      setError(
        err.response?.data?.detail ||
          "Batch check failed. Verify the backend and try again."
      );
    } finally {
      setBatchLoading(false);
    }
  }

  const reachableCount = history.filter(
    (item) => item.reachable === true
  ).length;

  const latestStatus = history[0]?.status_code ?? "â€”";

  return (
    <main className="dashboard">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">
            P
          </div>

          <div>
            <h1>API Pulse</h1>
            <p>Real-time website monitoring</p>
          </div>
        </div>

        <span
          className={`api-status ${apiOnline ? "online" : "offline"}`}
          aria-live="polite"
        >
          <span className="status-dot" />
          API {apiOnline ? "Online" : "Offline"}
        </span>
      </header>

      <section className="welcome">
        <p className="eyebrow">MONITORING OVERVIEW</p>

        <h2>
          Know when your websites are <span>up.</span>
        </h2>

        <p>
          Monitor website availability, HTTP status codes, response times,
          and previous checks in one place.
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
            Ã—
          </button>
        </div>
      )}

      <section className="summary-grid" aria-label="Monitoring summary">
        <Metric
          label="Saved Checks"
          value={history.length}
          detail="Recent database records"
          symbol="01"
        />

        <Metric
          label="Reachable Records"
          value={reachableCount}
          detail="Among recent saved checks"
          symbol="02"
        />

        <Metric
          label="Latest HTTP Status"
          value={latestStatus}
          detail="Most recent saved check"
          symbol="03"
        />
      </section>

      <section className="check-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">QUICK TEST</p>
            <h3>Single Website Check</h3>
            <p className="section-description">
              Test the availability and response time of a website.
            </p>
          </div>

          <span className="section-icon">01</span>
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
              required
            />

            <button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <span className="button-spinner" />
                  Checking...
                </>
              ) : (
                "Check Website"
              )}
            </button>
          </div>

          <p className="helper-text">
            Enter the full URL, including https://
          </p>
        </form>

        {result && (
          <div className="result-panel">
            <div className="result-heading">
              <div>
                <p className="eyebrow">CHECK RESULT</p>
                <h3>Website report</h3>
              </div>

              <span
                className={`result-badge ${
                  result.http_success ? "good" : "bad"
                }`}
              >
                {result.http_success
                  ? "HTTP Success"
                  : "HTTP Not Successful"}
              </span>
            </div>

            <p className="result-url">{result.url || url}</p>

            <div className="metrics">
              <Metric
                label="Reachable"
                value={result.reachable ? "Yes" : "No"}
              />

              <Metric
                label="HTTP Status"
                value={result.status_code ?? "â€”"}
              />

              <Metric
                label="Response Time"
                value={
                  result.response_time_ms != null
                    ? `${result.response_time_ms} ms`
                    : "â€”"
                }
              />
            </div>

            {result.error && (
              <p className="inline-error">{result.error}</p>
            )}
          </div>
        )}
      </section>

      <section className="check-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">MULTI-SITE TEST</p>
            <h3>Batch Website Check</h3>
            <p className="section-description">
              Check up to 10 websites in one request.
            </p>
          </div>

          <span className="section-icon">02</span>
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
            required
          />

          <p className="helper-text">
            Enter one URL per line or separate URLs with commas.
          </p>

          <button type="submit" disabled={batchLoading}>
            {batchLoading ? (
              <>
                <span className="button-spinner" />
                Checking websites...
              </>
            ) : (
              "Check All Websites"
            )}
          </button>
        </form>

        {batchResults.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Website</th>
                  <th>Reachable</th>
                  <th>HTTP Status</th>
                  <th>Response Time</th>
                </tr>
              </thead>

              <tbody>
                {batchResults.map((item, index) => (
                  <tr key={`${item.url}-${index}`}>
                    <td className="website-cell">{item.url}</td>

                    <td>
                      <StatusBadge reachable={item.reachable} />
                    </td>

                    <td>{item.status_code ?? "â€”"}</td>

                    <td>
                      {item.response_time_ms != null
                        ? `${item.response_time_ms} ms`
                        : "â€”"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="check-card">
        <div className="section-heading history-heading">
          <div>
            <p className="eyebrow">DATABASE</p>
            <h3>Recent Health History</h3>
            <p className="section-description">
              Review your previously saved website checks.
            </p>
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={loadHistory}
            disabled={historyLoading}
          >
            {historyLoading ? "Refreshing..." : "â†» Refresh History"}
          </button>
        </div>

        {historyLoading && history.length === 0 ? (
          <p className="empty-state">Loading history...</p>
        ) : history.length === 0 ? (
          <p className="empty-state">
            No saved checks found. Check a website to get started.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Website</th>
                  <th>Reachable</th>
                  <th>HTTP Status</th>
                  <th>Response Time</th>
                  <th>Checked At</th>
                </tr>
              </thead>

              <tbody>
                {history.map((item, index) => (
                  <tr key={item.id ?? `${item.url}-${index}`}>
                    <td className="website-cell">{item.url}</td>

                    <td>
                      <StatusBadge reachable={item.reachable} />
                    </td>

                    <td>{item.status_code ?? "â€”"}</td>

                    <td>
                      {item.response_time_ms != null
                        ? `${item.response_time_ms} ms`
                        : "â€”"}
                    </td>

                    <td>{formatDate(item.checked_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer>
        <span className="footer-brand">
          <span className="footer-dot" />
          API Pulse
        </span>

        <span>Built with React Â· FastAPI Â· SQLite</span>
      </footer>
    </main>
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

function StatusBadge({ reachable }) {
  return (
    <span className={`table-status ${reachable ? "good" : "bad"}`}>
      <span className="badge-dot" />
      {reachable ? "Reachable" : "Unreachable"}
    </span>
  );
}

function formatDate(value) {
  if (!value) return "â€”";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}

export default App;
