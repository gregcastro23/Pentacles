import { describe, expect, it } from 'bun:test';
import { PentacleArena3D } from '../src/lib/agents/pentacle-arena-3d';
import { FIXTURE_AGENTS } from '../src/lib/agents/rating-contract';

function seatedCourt() {
  const arena = new PentacleArena3D();
  const winner = structuredClone(FIXTURE_AGENTS[0]);
  const rival = structuredClone(FIXTURE_AGENTS[3]);
  winner.ratingSource = rival.ratingSource = 'live';
  winner.surge.active = rival.surge.active = false;
  const winningBody = arena.placeAvatarOnZone(0, winner)!;
  const rivalBody = arena.placeAvatarOnZone(0, rival, 'challenger')!;
  arena.updateZoneStatus(0, 6, 520);
  return { arena, winner, rival, winningBody, rivalBody };
}

describe('Confirmed court trick outcomes', () => {
  it('plays victory and stagger in place, preserves selection/control, and restores the latest surge state', async () => {
    const { arena, winner, rival, winningBody, rivalBody } = seatedCourt();
    try {
      arena.selectAgent(winner.key);
      const before = [winningBody.position.clone(), rivalBody.position.clone()];
      let finished = false;
      const result = arena.animateTrickOutcome(0, winner.key, rival.key).then(() => { finished = true; });
      arena.update(0.1);
      expect(winningBody.userData.animationState).toBe('victory');
      expect(rivalBody.userData.animationState).toBe('stagger');
      expect(winningBody.userData.footRing.scale.x).toBeGreaterThan(winningBody.userData.footRingRest.scale.x);
      expect(rivalBody.userData.footRing.position.z).toBeLessThan(rivalBody.userData.footRingRest.position.z);
      expect(winningBody.position.equals(before[0])).toBe(true);
      expect(rivalBody.position.equals(before[1])).toBe(true);
      expect(arena.selection?.agentId).toBe(winner.key);
      expect(arena.zones.get(0)!.owner).toBe(6);
      expect(arena.zones.get(0)!.control).toBe(520);
      arena.refreshAvatar({ ...winner, surge: { ...winner.surge, active: true, meter: 90 } });
      expect(winningBody.userData.animationState).toBe('victory');
      await Promise.resolve();
      expect(finished).toBe(false);
      arena.update(1.6);
      await result;
      expect(winningBody.userData.animationState).toBe('surge');
      expect(rivalBody.userData.animationState).toBe('idle');
    } finally { arena.destroy(); }
  });

  it('skips reactions with motion off and drains an active reaction when motion is disabled', async () => {
    const { arena, winner, rival, winningBody, rivalBody } = seatedCourt();
    try {
      arena.motionEnabled = false;
      await arena.animateTrickOutcome(0, winner.key, rival.key);
      expect(winningBody.userData.animationState).toBe('idle');
      arena.motionEnabled = true;
      const result = arena.animateTrickOutcome(0, winner.key, rival.key);
      arena.motionEnabled = false;
      arena.update(0);
      await result;
      expect(winningBody.userData.animationState).toBe('idle');
      expect(rivalBody.userData.animationState).toBe('idle');
    } finally { arena.destroy(); }
  });

  it('lets live movement interrupt a reaction and ignores stale results for departed participants', async () => {
    const { arena, winner, rival, winningBody, rivalBody } = seatedCourt();
    try {
      const result = arena.animateTrickOutcome(0, winner.key, rival.key);
      const trip = arena.moveAvatarToZone(winner.key, 1, 500);
      await result;
      await arena.animateTrickOutcome(0, winner.key, rival.key);
      expect(winningBody.userData.animationState).toBe('travel');
      expect(rivalBody.userData.animationState).toBe('idle');
      arena.update(0.5);
      await trip;
      await arena.animateTrickOutcome(0, winner.key, rival.key);
      expect(winningBody.userData.zoneId).toBe(1);
      expect(winningBody.userData.animationState).toBe('idle');
    } finally { arena.destroy(); }
  });

  it('settles reactions on seat removal or destruction without leaving the opponent in a reaction', async () => {
    const { arena, winner, rival, rivalBody } = seatedCourt();
    const removed = arena.animateTrickOutcome(0, winner.key, rival.key);
    arena.removeAvatar(winner.key);
    await removed;
    expect(rivalBody.userData.animationState).toBe('idle');
    arena.placeAvatarOnZone(0, winner);
    const destroyed = arena.animateTrickOutcome(0, winner.key, rival.key);
    arena.destroy();
    await destroyed;
    expect(arena.avatarRegistry.size).toBe(0);
  });
});
