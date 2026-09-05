import { ActivityIcon } from "./icons";
import type { StartupSnapshot } from "./desktop";

interface StartupViewProps {
  startup: StartupSnapshot;
  error: string;
  onRetry: () => void;
}

const stages = ["loadingSettings", "preparingRuntime", "startingEngine", "ready"] as const;

export function StartupView({ startup, error, onRetry }: StartupViewProps) {
  const currentIndex = stages.indexOf(startup.phase as (typeof stages)[number]);
  return (
    <section className={`startup-view ${startup.phase === "failed" ? "failed" : ""}`}>
      <div className="startup-mark"><ActivityIcon /></div>
      <p className="eyebrow">NetF startup</p>
      <h2>{startup.phase === "failed" ? "NetF needs attention" : startup.message}</h2>
      <p className="startup-explainer">
        {startup.phase === "failed"
          ? startup.message
          : "The interface remains responsive while the owned runtime and NetF engine are verified."}
      </p>
      <div className="startup-stages" aria-label="Startup progress">
        {stages.slice(0, 3).map((stage, index) => (
          <div className={index < currentIndex ? "done" : index === currentIndex ? "current" : ""} key={stage}>
            <span />
            {stage === "loadingSettings" ? "Settings" : stage === "preparingRuntime" ? "Runtime" : "Engine"}
          </div>
        ))}
      </div>
      {(error || startup.phase === "failed") && <div className="error-banner" role="alert">{error || startup.message}</div>}
      {startup.retryable && <button className="primary-action" onClick={onRetry} type="button">Retry startup</button>}
      <small>{startup.elapsedMs ? `${startup.elapsedMs} ms elapsed` : "Starting…"}</small>
    </section>
  );
}
