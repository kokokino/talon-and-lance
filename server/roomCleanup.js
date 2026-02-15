import { GameRooms, RoomStatus } from '../imports/lib/collections/gameRooms.js';

const CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 minutes
const STALE_THRESHOLD = 5 * 60 * 1000;   // 5 minutes

export function startRoomCleanup() {
  Meteor.setInterval(async () => {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD);

    // 1. Stale active rooms — no heartbeat for 5+ minutes
    const staleActive = await GameRooms.removeAsync({
      status: { $in: [RoomStatus.WAITING, RoomStatus.STARTING, RoomStatus.PLAYING] },
      lastActiveAt: { $lt: cutoff },
    });
    if (staleActive > 0) {
      console.log(`[roomCleanup] Removed ${staleActive} stale active room(s)`);
    }

    // 2. Finished rooms — lingering for 5+ minutes after game ended
    const staleFinished = await GameRooms.removeAsync({
      status: RoomStatus.FINISHED,
      finishedAt: { $lt: cutoff },
    });
    if (staleFinished > 0) {
      console.log(`[roomCleanup] Removed ${staleFinished} finished room(s)`);
    }

    // 3. Legacy rooms — active status but no lastActiveAt field (pre-deployment)
    const legacy = await GameRooms.removeAsync({
      status: { $in: [RoomStatus.WAITING, RoomStatus.STARTING, RoomStatus.PLAYING] },
      lastActiveAt: { $exists: false },
      createdAt: { $lt: cutoff },
    });
    if (legacy > 0) {
      console.log(`[roomCleanup] Removed ${legacy} legacy room(s) without lastActiveAt`);
    }
  }, CLEANUP_INTERVAL);
}
