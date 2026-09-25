import { Component } from "react";
import { AlertTriangle, Home, RotateCcw, WifiOff } from "lucide-react";
import { chunkRecovery, isStaleChunkError, probeAppServer, recentServerProbe, repairApplicationFiles } from "../lib/chunkRecovery.js";

const offline = () => globalThis.navigator?.onLine === false;
const SAFE = "Your notes and progress are safe.";
const COPY = {
  checking: ["This screen could not load", "Checking the connection…"],
  offline: ["This screen is not available offline yet", `It is not on this device yet. ${SAFE} Reconnect, then reload Lumen.`],
  unreachable: ["Lumen’s server cannot be reached", `This screen is not on this device yet. ${SAFE} Check that the server is running, then reload Lumen.`],
  reloading: ["Updating Lumen", "Downloading fresh app files…"],
  stale: ["Lumen needs fresh app files", `This screen belongs to a different or incomplete Lumen build. ${SAFE} Repair the app files while connected to the Lumen server.`],
  crash: ["Lumen could not render this screen", `${SAFE} Reload the app first. If the problem repeats, export a backup from Settings after the app recovers.`],
};

/**
 * One boundary, three placements. Around the whole app (main.jsx) it is the
 * last resort. With `inline` it wraps the screen inside <main>, so the top
 * bar, sidebar, and bottom navigation stay usable and navigating (resetKey)
 * clears it. With `fallback` it isolates an optional section such as Storage
 * health. A failed dynamic import stays failed for the life of the document,
 * so recovery reloads rather than retrying in place.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, status: "crash", resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error) {
    return { error, status: isStaleChunkError(error) ? (offline() ? "offline" : "checking") : "crash", repairing: false, repairError: "" };
  }

  static getDerivedStateFromProps(props, state) {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey };
  }

  componentDidMount() {
    window.addEventListener("online", this.reconnected);
  }

  componentWillUnmount() {
    this.unmounted = true;
    window.removeEventListener("online", this.reconnected);
  }

  componentDidCatch(error, info) {
    // React already reports errors caught by the nested boundaries.
    if (!this.props.inline && !this.props.fallback) console.error("Lumen rendering failure", error, info);
    if (!this.props.fallback && isStaleChunkError(error)) this.checkConnection(error);
  }

  reconnected = () => {
    if (this.state.error && ["offline", "unreachable"].includes(this.state.status)) this.checkConnection(this.state.error);
  };

  // Tell "not downloaded while offline" apart from a stale or incomplete build.
  // When the server answers, spend the same bounded automatic reload that lazy
  // imports use.
  checkConnection = async (error) => {
    if (offline()) return this.setState({ status: "offline" });
    const known = recentServerProbe(error);
    if (known === undefined) this.setState({ status: "checking" });
    const reachable = known ?? await probeAppServer();
    if (this.unmounted || this.state.error !== error) return;
    if (!reachable) this.setState({ status: offline() ? "offline" : "unreachable" });
    else this.setState({ status: chunkRecovery.schedule(error) ? "reloading" : "stale" });
  };

  repairFiles = async () => {
    this.setState({ repairing: true, repairError: "" });
    try {
      await repairApplicationFiles();
    } catch (error) {
      this.setState({ repairing: false, repairError: error?.message || "App files could not be repaired." });
    }
  };

  goHome = () => {
    if (this.props.inline) return this.props.onHome();
    window.location.hash = "#/home";
    window.location.reload();
  };

  render() {
    const { error, status, repairing, repairError } = this.state;
    const { inline, fallback } = this.props;
    if (!error) return this.props.children;
    if (fallback) return fallback;
    const [title, detail] = COPY[status];
    const busy = status === "checking" || status === "reloading";
    const Icon = status === "offline" || status === "unreachable" ? WifiOff : AlertTriangle;
    // Inline on Home itself, "Go to Home" would not change the view or clear
    // the error, so Reload becomes the primary action there.
    const canGoHome = !inline || Boolean(this.props.onHome);
    const reload = <button className={status === "stale" || (inline && canGoHome) ? "button secondary" : "button primary"} onClick={() => window.location.reload()} type="button"><RotateCcw size={17} aria-hidden="true" /> Reload Lumen</button>;
    const home = canGoHome && <button className={inline && status !== "stale" ? "button primary" : "button secondary"} onClick={this.goHome} type="button"><Home size={17} aria-hidden="true" /> Go to Home</button>;
    const content = <>
      <Icon size={30} aria-hidden="true" />
      <div role={busy ? "status" : "alert"}><h1>{title}</h1><p>{detail}</p></div>
      {repairError && <p className="fatal-error-status" role="status">{repairError}</p>}
      {!busy && <div className="fatal-error-actions">
        {status === "stale" && <button className="button primary" disabled={repairing} onClick={this.repairFiles} type="button"><RotateCcw size={17} aria-hidden="true" /> {repairing ? "Checking app files…" : "Repair app files"}</button>}
        {inline ? <>{home}{reload}</> : <>{reload}{home}</>}
      </div>}
      <details><summary>Technical detail</summary><code>{error.message || String(error)}</code></details>
    </>;
    return inline
      ? <div className="page route-error"><section className="empty-state route-error-panel">{content}</section></div>
      : <main className="fatal-error"><div className="brand-mark">L</div>{content}</main>;
  }
}
