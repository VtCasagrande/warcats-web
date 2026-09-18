import type { Match, Player } from './types';

// Compact positional tuples keep repeated property names out of 15 Hz snapshots.
// A single field list is shared by the encoder and decoder to avoid schema drift.
const PLAYER_FIELDS = [
  'id', 'name', 'team', 'bot', 'x', 'y', 'z', 'yaw', 'pitch', 'vy', 'health', 'armor',
  'stamina', 'weapon', 'sight', 'muzzle', 'grip', 'ammo', 'reserve', 'reloadUntil', 'healUntil', 'nextShot',
  'grenades', 'medkits', 'bags', 'class', 'xp', 'level', 'crouch', 'sprinting', 'grounded', 'state', 'respawnAt',
  'bleedAt', 'protectedUntil', 'lastDamage', 'kills', 'deaths', 'assists', 'revives',
  'vx','vz','jumpHeld','sprintLocked','staminaRecoveryAt','distanceTraveled','aiming','steady','scopeZoom','buildMode','buildRotation','buildUntil','lifeSpent',
  'captures', 'credits', 'earned', 'lastAttacker', 'reviveProgress', 'seq', 'buildAt', 'pingAt',
  'vehicleId','vehicleSeat','suppression','supportPoints','transports','skin',
  'primary', 'secondary', 'slot', 'primaryAmmo', 'primaryReserve', 'secondaryAmmo', 'secondaryReserve',
  'primarySight','primaryMuzzle','primaryGrip','paidAttachments','prone','throwUntil','throwReleased','proneYaw','parachute','bloom',
] as const satisfies readonly (keyof Player)[];
type Packed = Omit<Match, 'players'> & { players: unknown[][] };
const rounded = (value: unknown) => typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;

export function packState(state: Match, afterEvent = -1): Packed {
  return {
    ...state, time: rounded(state.time) as number,
    players: Object.values(state.players).map(p => PLAYER_FIELDS.map(key => rounded(p[key]))),
    bullets: state.bullets.slice(-70).map(b => ({ ...b, x: rounded(b.x) as number, y: rounded(b.y) as number, z: rounded(b.z) as number })),
    events: state.events.filter(e => e.id > afterEvent),
  };
}

export function unpackState(packed: Packed): Match {
  const players: Record<string, Player> = {};
  for (const tuple of packed.players) {
    const player = Object.fromEntries(PLAYER_FIELDS.map((key, i) => [key, tuple[i]])) as Player;
    player.prone??=false;player.throwUntil??=0;player.throwReleased??=false;player.parachute??=false;player.fallImpact??=0;player.accountId=null;player.vehicleId??=null;player.vehicleSeat??=-1;player.suppression??=0;player.supportPoints??=0;player.transports??=0;player.skin??='standard';player.bloom??=0;player.earned??=0;
    player.class = player.class || 'assault';
    player.bags = player.bags || 0;
    player.xp = player.xp || 0;
    player.level = player.level || 1;
    player.slot = (player.slot === 1 || player.slot === 2 ? player.slot : 0) as Player['slot'];
    player.primary = player.primary || player.weapon;
    player.primarySight??=player.sight;player.primaryMuzzle??=player.muzzle;player.primaryGrip??=player.grip;player.paidAttachments??=[];
    player.secondary = player.secondary || 'pistol';
    players[player.id] = player;
  }
  packed.crates ??= [];packed.vehicles??=[];packed.spots??=[];
  return { ...packed, players };
}
