/**
 * useBackgroundMusic — low-volume looping background music for /world.
 *
 * Plays "world-theme" on the /world route. Respects browser autoplay policy
 * by starting playback on the first user interaction. Volume is kept low (0.08)
 * so it sits behind game UI sounds. Persists mute preference in localStorage.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { ASSET_BASE_URL } from "@/config";

const STORAGE_KEY = "wog-music-muted";
const VOLUME = 0.08;

function getMusicUrl(track: string): string {
  const base = ASSET_BASE_URL ? `${ASSET_BASE_URL}/audio` : "/audio";
  return `${base}/${track}.mp3`;
}

export function useBackgroundMusic(track: "main-theme" | "world-theme" = "world-theme") {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startedRef = useRef(false);
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  });

  // Create audio element once
  useEffect(() => {
    const audio = new Audio(getMusicUrl(track));
    audio.loop = true;
    audio.volume = VOLUME;
    audio.preload = "auto";
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
      startedRef.current = false;
    };
  }, [track]);

  // Sync mute state
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = muted;
    try { localStorage.setItem(STORAGE_KEY, muted ? "1" : "0"); } catch {}
  }, [muted]);

  // Start playback on first user interaction (autoplay policy)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || muted) return;

    const tryPlay = () => {
      if (startedRef.current) return;
      audio.play().then(() => {
        startedRef.current = true;
      }).catch(() => {});
    };

    // Try immediately (works if user already interacted)
    tryPlay();

    // Otherwise wait for interaction
    const events = ["click", "touchstart", "keydown"] as const;
    const handler = () => {
      tryPlay();
      if (startedRef.current) {
        events.forEach((e) => document.removeEventListener(e, handler));
      }
    };
    events.forEach((e) => document.addEventListener(e, handler, { once: false, passive: true }));

    return () => {
      events.forEach((e) => document.removeEventListener(e, handler));
    };
  }, [muted, track]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      const audio = audioRef.current;
      if (audio) {
        audio.muted = next;
        if (!next && audio.paused) {
          audio.play().catch(() => {});
        }
      }
      return next;
    });
  }, []);

  return { muted, toggleMute };
}
