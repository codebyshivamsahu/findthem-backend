// src/services/faceMatch.ts
// Talks to the Python face service (face_server.py) on the server side.
//
// This used to run in the browser, which meant every open case's photos were
// shipped to the client and the resulting score was posted back — so anyone
// could send any number. Now the API asks the service itself, and the browser
// never sees or supplies a score.
//
// IMPORTANT: what comes back is *image similarity*, not identification. It is
// stored as a sorting hint for reviewers. It never verifies a sighting, never
// changes a case's status, and never appears in anything sent to a family.
import { config } from '../config';

interface MatchResponse {
  face_detected?: boolean;
  matches?: { caseId: string; similarity?: number; confidence?: number }[];
}

const TIMEOUT_MS = 15_000;

/**
 * Returns a similarity score (0-100) for a sighting photo against one case's
 * photos, or null when the service is unavailable, no face was found, or no
 * photo was supplied. Never throws — a scoreless sighting is still a sighting.
 */
export async function scoreSightingPhoto(
  sightingPhoto: string | null | undefined,
  caseId: string,
  casePhotos: string[]
): Promise<number | null> {
  if (!config.FACE_SERVICE_URL || !sightingPhoto || casePhotos.length === 0) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${config.FACE_SERVICE_URL.replace(/\/$/, '')}/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sighting_photo: sightingPhoto,
        cases: [{ caseId, name: '', photos: casePhotos.slice(0, 5) }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`Face service returned ${response.status}`);
      return null;
    }

    const data = (await response.json()) as MatchResponse;
    const match = data.matches?.[0];
    const score = match?.similarity ?? match?.confidence;
    return typeof score === 'number' ? Math.round(score * 10) / 10 : null;
  } catch (err: any) {
    // Service asleep, timed out, or unreachable. Not an error the reporter
    // should ever see — their sighting is already saved.
    console.warn('Face service unavailable:', err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
