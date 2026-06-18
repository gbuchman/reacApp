import React, { useEffect, useState, useRef } from "react";
import "./App.css";

const API_URL = `http://${window.location.hostname}:3300/commands`;
const LOGS_STREAM_URL = `http://${window.location.hostname}:3300/logs/stream`;
const LOGS_TAIL_URL = `http://${window.location.hostname}:3300/logs/tail`;

async function sendCommand(cmd, arg, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(arg ? { cmd, arg } : { cmd }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, data: err.name === "AbortError" ? "Timeout" : err.message };
  }
}

function extractConfigPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  if (payload.config && typeof payload.config === "object") return extractConfigPayload(payload.config);
  if (payload.data && typeof payload.data === "object") return extractConfigPayload(payload.data);
  if (payload.payload && typeof payload.payload === "object") return extractConfigPayload(payload.payload);
  return payload;
}

function normalizeReaderConfig(reader) {
  if (!reader || typeof reader !== "object") return null;
  const baud = reader.baud ?? reader.baudrate ?? reader.baud_rate ?? reader.speed ?? reader.rate;
  const type = reader.type ?? reader.readerType ?? reader.readertype ?? reader.mode ?? reader.format;

  return {
    baud: baud != null ? String(baud) : undefined,
    type: type != null ? String(type).toLowerCase() : undefined,
  };
}

function normalizeConfig(payload) {
  const config = extractConfigPayload(payload) || {};

  const reader0 = normalizeReaderConfig(
    config.reader0 ?? config["reader-0"] ?? config.reader_0 ?? (config.readers && config.readers[0]) ?? {
      baud: config.osdpReader1BaudRate ?? config.reader1BaudRate ?? config.reader1_baud_rate,
      type: config.reader1Type ?? config.reader1type ?? config.reader1_type,
    }
  );

  const reader1 = normalizeReaderConfig(
    config.reader1 ?? config["reader-1"] ?? config.reader_1 ?? (config.readers && config.readers[1]) ?? {
      baud: config.osdpReader2BaudRate ?? config.reader2BaudRate ?? config.reader2_baud_rate,
      type: config.reader2Type ?? config.reader2type ?? config.reader2_type,
    }
  );

  const logLevel = config.logLevel ?? config.log_level ?? config.loglevel;

  return {
    reader0,
    reader1,
    logLevel: logLevel != null ? String(logLevel) : undefined,
  };
}

function extractLogLevel(payload) {
  if (payload == null) return undefined;
  if (typeof payload === "string") return payload;
  if (typeof payload === "object") {
    return (
      payload.logLevel ?? payload.log_level ?? payload.loglevel ?? payload.level ?? payload.data ?? undefined
    );
  }
  return String(payload);
}

// Strip ANSI color codes from log lines
function stripAnsiCodes(line) {
  return String(line).replace(/\x1b\[[0-9;]*m/g, '').replace(/\u001b\[[0-9;]*m/g, '');
}



function ReaderPanel({ readerId, setConnection, baud, setBaud, readerMode, setReaderMode }) {
  const [log, setLog] = useState("");
  const baudOptions = ["9600", "38400", "57600", "115200"];
  const modeOptions = ["wiegand", "osdp"];
  const normalizedMode = readerMode ? String(readerMode).toLowerCase() : "";
  const normalizedBaud = readerMode ? String(baud) : "";

  const send = async (cmd, arg) => {
    const res = await sendCommand(cmd, arg);
    setLog(JSON.stringify(res.data, null, 2));
    setConnection(res.ok);
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <h3>Reader {readerId}</h3>
        <span className="badge">{normalizedMode.toUpperCase()}</span>
      </div>

      <div className="panel-row">
        <label>
          Baud Rate
          <select value={baud} onChange={(e) => setBaud(e.target.value)}>
            {baudOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
            {baud && !baudOptions.includes(baud) ? (
              <option key="custom-baud" value={baud}>{`Custom: ${baud}`}</option>
            ) : null}
          </select>
        </label>
        <button className="button-primary" onClick={() => send("setbaudrate", `${readerId} ${baud}`)}>
          Set Baud
        </button>
      </div>

      <div className="panel-row">
        <label>
          Reader Mode
          <select value={normalizedMode} onChange={(e) => setReaderMode(e.target.value)}>
            {modeOptions.map((option) => (
              <option key={option} value={option}>{option.charAt(0).toUpperCase() + option.slice(1)}</option>
            ))}
            {normalizedMode && !modeOptions.includes(normalizedMode) ? (
              <option key="custom-mode" value={normalizedMode}>{`Custom: ${normalizedMode}`}</option>
            ) : null}
          </select>
        </label>
        <button className="button-primary" onClick={() => send("setreadertype", `${readerId} ${readerMode}`)}>
          Set Mode
        </button>
      </div>

      <div className="panel-log">
        <code>{log || "No response yet."}</code>
      </div>
    </section>
  );
}

function ControlPanel({ setConnection, logLevel, setLogLevel, onUpdateConfig, className }) {
  const [degrees, setDegrees] = useState(90);
  const [log, setLog] = useState("");
  const [commandInput, setCommandInput] = useState("");

  const send = async (cmd, arg, timeoutMs) => {
    const res = await sendCommand(cmd, arg, timeoutMs);
    if (cmd === "getconfig" && res.ok && typeof onUpdateConfig === "function") {
      const payload = extractConfigPayload(res.data);
      onUpdateConfig(payload || {});
    }
    if (cmd === "getloglevel" && res.ok) {
      const parsed = extractLogLevel(res.data);
      if (parsed) setLogLevel(parsed);
    }
    setLog(JSON.stringify(res.data, null, 2));
    setConnection(res.ok);
  };

  const sendCustomCommand = async () => {
    const trimmed = String(commandInput || "").trim();
    if (!trimmed) {
      setLog("Please enter a command.");
      return;
    }

    const [cmd, ...rest] = trimmed.split(/\s+/);
    const arg = rest.length > 0 ? rest.join(" ") : undefined;
    await send(cmd, arg);
  };

  const handleCommandKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendCustomCommand();
    }
  };

  return (
    <section className={`panel ${className || ""}`}>
      <div className="panel-header">
        <h3>Control</h3>
      </div>

      <div className="panel-row panel-row-wrap">
        <button className="button-secondary" onClick={() => send("getconfig")}>Get Config</button>
        <button className="button-secondary" onClick={() => send("getloglevel")}>Get Log Level</button>
        <button className="button-secondary button-reboot" onClick={() => send("reboot")}>Reboot</button>
      </div>

      <div className="panel-row">
        <label>
          Log Level
          <select value={logLevel} onChange={(e) => setLogLevel(e.target.value)}>
            <option value="error">Error</option>
            <option value="warn">Warn</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
            <option value="trace">Trace</option>
          </select>
        </label>
        <button className="button-primary" onClick={() => send("setloglevel", logLevel)}>
          Set Log Level
        </button>
      </div>

      <div className="panel-row">
        <label>
          Motor Degrees
          <input type="number" value={degrees} onChange={(e) => setDegrees(e.target.value)} />
        </label>
        <button className="button-primary" onClick={() => send("motormove", degrees)}>
          Move Motor
        </button>
      </div>

      <div className="panel-row">
        <button className="button-secondary" onClick={() => send("saveeeprom")}>Save EEPROM</button>
        <button className="button-secondary" onClick={() => send("rehome", undefined, 10000)}>Rehome</button>
      </div>

      <div className="panel-row">
        <label style={{ flex: 1, minWidth: 0 }}>
          Command Input
          <input
            type="text"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            onKeyDown={handleCommandKeyDown}
            placeholder="Example: reset arg1 arg2"
          />
        </label>
        <button className="button-primary" onClick={sendCustomCommand}>
          Send Cmd
        </button>
      </div>

      <div className="panel-log">
        <code>{log || "No response yet."}</code>
      </div>
    </section>
  );
}

function LogViewer() {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [attempting, setAttempting] = useState(false);
  const socketRef = useRef(null);

  const getSeverityClass = (line) => {
    const normalized = String(line).toLowerCase();
    if (normalized.includes("[error]") || normalized.includes("\"level\":50") || normalized.includes("\"level\":60")) return "severity-error";
    if (normalized.includes("[warn]") || normalized.includes("\"level\":40")) return "severity-warn";
    if (normalized.includes("[info]") || normalized.includes("\"level\":30")) return "severity-info";
    if (normalized.includes("[debug]") || normalized.includes("\"level\":20")) return "severity-debug";
    if (normalized.includes("[trace]") || normalized.includes("\"level\":10")) return "severity-trace";
    return "";
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const downloadLogs = () => {
    if (logs.length === 0) return;
    const blob = new Blob([logs.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "device-logs.txt";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const parseBunyanJson = (line) => {
    const text = String(line).trim();
    if (!text.startsWith("{")) return null;

    try {
      const obj = JSON.parse(text);
      const time = obj.time || obj.timestamp || obj.ts || "";
      const levelValue = obj.level ?? obj.levelName ?? obj.levelname ?? "info";
      const msg = obj.msg ?? obj.message ?? "";
      const name = obj.name || obj.logger || "";
      const pid = obj.pid ?? obj.processId ?? "";
      const levelMap = {
        10: "trace",
        20: "debug",
        30: "info",
        40: "warn",
        50: "error",
        60: "fatal",
      };
      const normalizedLevel = typeof levelValue === "number" ? levelMap[levelValue] || "info" : String(levelValue).toLowerCase();
      const severityClass = `severity-${normalizedLevel}`;
      const extraFields = Object.entries(obj).filter(
        ([key]) => !["time", "timestamp", "ts", "level", "levelName", "levelname", "msg", "message", "name", "logger", "pid", "processId", "v"].includes(key),
      );

      return (
        <>
          {time ? <span className="bunyan-time">{time}</span> : null}
          <span className={`bunyan-level ${severityClass}`}>{normalizedLevel.toUpperCase()}</span>
          {name ? <span className="bunyan-name">{name}</span> : null}
          {pid ? <span className="bunyan-meta">pid={pid}</span> : null}
          <span className="bunyan-msg">{String(msg)}</span>
          {extraFields.map(([key, value]) => (
            <span key={key} className="bunyan-meta">
              <span className="bunyan-field-key">{key}:</span> <span className="bunyan-field-value">{String(value)}</span>
            </span>
          ))}
        </>
      );
    } catch (e) {
      return null;
    }
  };

  const renderLogLine = (line) => {
    const parsed = parseBunyanJson(line);
    if (parsed) return parsed;

    const text = String(line);
    const tokenRegex = /(\[(?:info|warn|error|debug|trace)\])/gi;
    const parts = text.split(tokenRegex).filter(Boolean);

    return parts.map((part, idx) => {
      if (part.match(tokenRegex)) {
        return (
          <span key={idx} className={`bunyan-level ${getSeverityClass(part)}`}>
            {part}
          </span>
        );
      }

      return <span key={idx}>{part}</span>;
    });
  };

  const connectToLogs = async () => {
    console.log("=== LogViewer connectToLogs called ===");
    setAttempting(true);
    setError(null);
    setLogs([]);

    try {
      // Fetch initial log tail
      const tailRes = await fetch(`${LOGS_TAIL_URL}?lines=500`);
      if (tailRes.ok) {
        const data = await tailRes.json();
        const cleanedLines = (data.lines || []).map(stripAnsiCodes);
        setLogs(cleanedLines);
      }

      // Connect to streaming endpoint
      console.log("Connecting to log stream:", LOGS_STREAM_URL);
      const eventSource = new EventSource(LOGS_STREAM_URL);

      eventSource.onopen = () => {
        console.log("Log stream connected");
        setConnected(true);
        setAttempting(false);
        setError(null);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.line) {
            const cleanedLine = stripAnsiCodes(data.line);
            console.log("Received log line:", cleanedLine);
            setLogs((prev) => {
              const updated = [...prev, String(cleanedLine)];
              return updated.slice(-500);
            });
          }
        } catch (err) {
          console.error("Failed to parse log event:", err);
        }
      };

      eventSource.onerror = (err) => {
        console.error("Log stream error:", err);
        setError("Connection to log stream failed");
        setConnected(false);
        setAttempting(false);
        eventSource.close();
      };

      socketRef.current = eventSource;
    } catch (err) {
      console.error("Log viewer connect error:", err);
      setError(err.message || String(err));
      setAttempting(false);
      setConnected(false);
    }
  };

  useEffect(() => {
    console.log("LogViewer component mounted");
    connectToLogs();

    return () => {
      console.log("LogViewer component unmounting");
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);


  return (
    <section className="log-viewer">
      <div className="log-viewer-header">
        <h3>Live Device Logs</h3>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <span className={`status-indicator ${connected ? "connected" : "disconnected"}`}>
            {attempting ? "Connecting..." : connected ? "Streaming" : "Offline"}
          </span>
          <button 
            className="button-secondary" 
            onClick={connectToLogs}
            disabled={attempting}
            style={{ padding: "6px 12px", fontSize: "0.85rem" }}
          >
            {attempting ? "Connecting..." : "Retry Connection"}
          </button>
          <button
            className="button-secondary"
            onClick={clearLogs}
            style={{ padding: "6px 12px", fontSize: "0.85rem" }}
          >
            Clear Logs
          </button>
          <button
            className="button-secondary"
            onClick={downloadLogs}
            disabled={logs.length === 0}
            style={{ padding: "6px 12px", fontSize: "0.85rem" }}
          >
            Download
          </button>
        </div>
      </div>
      {error && (
        <div className="log-error">
          <strong>Error:</strong> {error}
        </div>
      )}
      <div className="log-content">
        {logs.length === 0 ? (
          <div className="log-empty">
            {error ? "Failed to connect to log stream" : attempting ? "Connecting to device..." : "Waiting for logs..."}
          </div>
        ) : (
          logs.map((line, idx) => (
            <div key={idx} className={`log-line ${getSeverityClass(line)}`}>
              {renderLogLine(line)}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default function App() {
  const [connected, setConnected] = useState(true);
  const [logLevel, setLogLevel] = useState("info");

  const [reader0, setReader0] = useState({ baud: "9600", type: "wiegand" });
  const [reader1, setReader1] = useState({ baud: "9600", type: "wiegand" });

  const updateReaders = (config) => {
    const normalized = normalizeConfig(config);

    if (normalized.reader0) {
      setReader0((prev) => ({
        baud: normalized.reader0.baud ?? prev.baud,
        type: normalized.reader0.type ?? prev.type,
      }));
    }

    if (normalized.reader1) {
      setReader1((prev) => ({
        baud: normalized.reader1.baud ?? prev.baud,
        type: normalized.reader1.type ?? prev.type,
      }));
    }

    if (normalized.logLevel) {
      setLogLevel(normalized.logLevel);
    }

    console.log("Normalized config:", normalized);
  };

  useEffect(() => {
    async function loadInitialState() {
      const configRes = await sendCommand("getconfig");
      if (configRes.ok) {
        updateReaders(configRes.data || {});
        setConnected(true);
      } else {
        setConnected(false);
      }

      const logLevelRes = await sendCommand("getloglevel");
      if (logLevelRes.ok) {
        const level = extractLogLevel(logLevelRes.data);
        if (level) setLogLevel(level);
      }
    }

    loadInitialState();
  }, []);

  return (
    <div className="app-root">
      <header className="app-header">
        <div>
          <p className="eyebrow">Red Diamond Fixture</p>
          <h1>Red Diamond TF Dashboard</h1>
        </div>
        <div className={`status-pill ${connected ? "status-online" : "status-offline"}`}>
          {connected ? "Connected" : "Disconnected"}
        </div>
      </header>

      <main className="panel-grid">
        <ReaderPanel
          readerId={0}
          setConnection={setConnected}
          baud={reader0.baud}
          setBaud={(v) => setReader0({ ...reader0, baud: v })}
          readerMode={reader0.type}
          setReaderMode={(v) => setReader0({ ...reader0, type: v })}
        />

        <ReaderPanel
          readerId={1}
          setConnection={setConnected}
          baud={reader1.baud}
          setBaud={(v) => setReader1({ ...reader1, baud: v })}
          readerMode={reader1.type}
          setReaderMode={(v) => setReader1({ ...reader1, type: v })}
        />

        <ControlPanel
          className="panel-control"
          setConnection={setConnected}
          logLevel={logLevel}
          setLogLevel={setLogLevel}
          onUpdateConfig={(config) => {
            updateReaders(config);
            if (config.logLevel) setLogLevel(String(config.logLevel));
          }}
        />
      </main>

      <LogViewer />
    </div>
  );
}
