import { useEffect, useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { SplashScreen } from "./components/SplashScreen";

function App() {
  const convexUrl = import.meta.env.VITE_CONVEX_URL;
  const operatorEmail = import.meta.env.VITE_OPERATOR_EMAIL ?? "operator@qualia.work";
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timeout = window.setTimeout(() => setShowSplash(false), 2200);
    return () => window.clearTimeout(timeout);
  }, []);

  if (!convexUrl) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--ink)] p-8 text-[var(--bone)]">
        <div className="max-w-xl border border-[var(--line)] bg-[var(--panel)] p-8">
          <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">Qualia Setup</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.08em]">Convex deployment required</h1>
          <p className="mt-4 text-sm leading-6 text-[var(--soft)]">
            Qualia is wired for a desktop-first Tauri shell, but this build expects a live Convex deployment for
            realtime balances, sessions, tasks, and admin analytics. Set <code>VITE_CONVEX_URL</code> and rerun the app
            to unlock the connected workplace surface.
          </p>
        </div>
      </main>
    );
  }

  return (
    <>
      {showSplash ? <SplashScreen progressLabel="Linking secure operator workspace" /> : null}
      <div className={showSplash ? "qualia-app qualia-app--hidden" : "qualia-app qualia-app--visible"}>
        <Dashboard operatorEmail={operatorEmail} />
      </div>
    </>
  );
}

export default App;
