const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

export interface ParsedYouTubeUrl {
  videoId: string;
  url: string; // normalized watch URL
}

export function parseYouTubeUrl(input: string): ParsedYouTubeUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;

  const host = parsed.hostname.toLowerCase();
  let videoId: string | null = null;

  if (host === "youtu.be") {
    videoId = parsed.pathname.split("/")[1] || null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (parsed.pathname === "/watch") {
      videoId = parsed.searchParams.get("v");
    } else if (parsed.pathname.startsWith("/shorts/") || parsed.pathname.startsWith("/embed/")) {
      videoId = parsed.pathname.split("/")[2] ?? null;
    }
  }

  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  return { videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
}