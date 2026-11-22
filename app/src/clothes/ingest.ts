import { parseClothesRaw } from './validation';
import { clipIdForDevice, clothesState, defaultClipId, insertClothesRaw } from './store';

let pending = 0;
// deviceId: the id in the clip's topic; null for the shared topic of firmware before 0.5.0.
export async function ingestClothesRaw(message: string, receivedAt: Date, retained = false, deviceId: string | null = null): Promise<void> {
  // A retained message may be old; arrival time must not make it appear newly measured.
  if (retained) throw new Error('Retained clothes telemetry is not accepted');
  const raw = parseClothesRaw(message);
  if (pending >= 16) throw new Error('Clothes ingestion busy; record dropped');
  pending++;
  try {
    const clipId = deviceId ? await clipIdForDevice(deviceId) : await defaultClipId();
    if (!clipId) throw new Error('No clip to store the reading for');
    await insertClothesRaw(raw, receivedAt, clipId);
    clothesState.lastError = null;
  } catch (error) {
    clothesState.lastError = 'Database write failed';
    throw error;
  } finally {
    pending--;
  }
}
