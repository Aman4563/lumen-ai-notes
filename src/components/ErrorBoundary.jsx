import { Component } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { isStaleChunkError, repairApplicationFiles } from "../lib/chunkRecovery.js";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, repairing: false, repairError: "" };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Lumen rendering failure", error, info);
  }

  repairFiles = async () => {
    this.setState({ repairing: true, repairError: "" });
    try {
      await repairApplicationFiles();
    } catch (error) {
      this.setState({ repairing: false, repairError: error?.message || "App files could not be repaired." });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    const staleFiles = isStaleChunkError(this.state.error);
    return (
      <main className="fatal-error" role="alert">
        <div className="brand-mark">L</div>
        <AlertTriangle size={30} />
        <h1>{staleFiles ? "Lumen needs fresh app files" : "Lumen could not render this screen"}</h1>
        <p>{staleFiles
          ? "This screen belongs to a different or incomplete Lumen build. Your notes and whiteboards are stored separately and have not been deleted. Connect to the Lumen server, then repair the app files."
          : "Your local notes have not been deleted. Reload the app first. If the problem repeats, export a backup from Settings after the app recovers."}</p>
        {this.state.repairError && <p className="fatal-error-status" role="status">{this.state.repairError}</p>}
        <details>
          <summary>Technical detail</summary>
          <code>{this.state.error.message}</code>
        </details>
        <div className="fatal-error-actions">
          {staleFiles && <button className="button primary" disabled={this.state.repairing} onClick={this.repairFiles} type="button"><RotateCcw size={17} /> {this.state.repairing ? "Checking app files…" : "Repair app files"}</button>}
          <button className={staleFiles ? "button secondary" : "button primary"} onClick={() => window.location.reload()} type="button"><RotateCcw size={17} /> Reload Lumen</button>
        </div>
      </main>
    );
  }
}
