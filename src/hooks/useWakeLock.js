import { useCallback, useEffect, useRef, useState } from "react";

export function useWakeLock(enabled) {
  const sentinelRef = useRef(null);
  const enabledRef = useRef(enabled);
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const supported = typeof navigator !== "undefined" && "wakeLock" in navigator;

  enabledRef.current = enabled;

  const release = useCallback(async () => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    if (sentinel) await sentinel.release().catch(() => {});
    setActive(false);
  }, []);

  const request = useCallback(async () => {
    if (!enabledRef.current || !supported || document.visibilityState !== "visible" || sentinelRef.current) return;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      if (!enabledRef.current) {
        await sentinel.release().catch(() => {});
        return;
      }
      sentinelRef.current = sentinel;
      setActive(true);
      setError("");
      sentinel.addEventListener("release", () => {
        if (sentinelRef.current === sentinel) sentinelRef.current = null;
        setActive(false);
      }, { once: true });
    } catch (wakeError) {
      setActive(false);
      setError(wakeError?.message || "Screen wake lock could not be enabled");
    }
  }, [supported]);

  useEffect(() => {
    if (enabled) request();
    else release();
  }, [enabled, release, request]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && enabledRef.current) request();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [request]);

  useEffect(() => () => {
    sentinelRef.current?.release().catch(() => {});
  }, []);

  return { supported, active, error, request, release };
}
