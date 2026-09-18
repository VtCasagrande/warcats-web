export type Team = 0 | 1 | 2;
export type SkinId = 'standard' | 'woodland' | 'desert' | 'arctic' | 'urban' | 'carbon' | 'ember' | 'naval';
export type VehicleKind = 'jeep' | 'helicopter';
export type Vehicle = Vec3 & { groundHeight?: number; landed?: boolean; steering?: number; yawRate?: number; rotorSpeed?: number; collective?: number; id: string; kind: VehicleKind; team: Team; yaw: number; pitch: number; roll: number; vx: number; vy: number; vz: number; speed: number; health: number; maxHealth: number; fuel: number; seats: (string | null)[]; respawnAt: number; rotor: number; spawn: { x: number; z: number }; distance: number };
export type Spot = Vec3 & { id: string; target: string; team: Team; by: string; expiresAt: number };
export type WeaponId = 'ar' | 'smg' | 'dmr' | 'ak' | 'lmg' | 'm40' | 'awm' | 'shotgun' | 'pistol' | 'rpg' | 'knife';
export type WeaponSlot = 0 | 1 | 2;
export type SightId = 'iron' | 'reflex' | 'holo' | 'optic';
export type MuzzleId = 'stock' | 'comp' | 'supp';
export type GripId = 'stock' | 'vert';
export type OperatorClass = 'assault' | 'medic' | 'engineer' | 'support' | 'demo';
export type MapId = 'nordhaven' | 'quarry' | 'harbor' | `custom-${string}`;
export type MatchPhase = 'warmup' | 'active' | 'results' | 'intermission';
export type Vec3 = { x: number; y: number; z: number };
export type Input = {
  seq: number; forward: number; strafe: number; yaw: number; pitch: number;
  fire: boolean; aim: boolean; sprint: boolean; crouch: boolean; prone: boolean; jump: boolean;
  reload: boolean; heal: boolean; grenade: boolean; interact: boolean; build: boolean; ping: boolean;
  place: boolean; rotate: boolean; cancel: boolean; zoom: boolean; steady: boolean;
  brake: boolean; equip: number; vehicle: boolean; ascend: boolean; descend: boolean; parachute: boolean;
};
export const emptyInput = (): Input => ({
  seq: 0, forward: 0, strafe: 0, yaw: 0, pitch: 0, fire: false, aim: false,
  sprint: false, crouch: false, prone: false, jump: false, reload: false, heal: false,
  grenade: false, interact: false, build: false, ping: false,
  place: false, rotate: false, cancel: false, zoom: false, steady: false, brake: false, equip: -1, vehicle: false, ascend: false, descend: false, parachute: false,
});
export type Player = Vec3 & {
  id: string; name: string; team: Team; bot: boolean; yaw: number; pitch: number; vy: number;
  vx: number; vz: number; jumpHeld: boolean; sprintLocked: boolean; staminaRecoveryAt: number; distanceTraveled: number;
  aiming: boolean; steady: boolean; scopeZoom: number; buildMode: boolean; buildRotation: number; buildUntil: number;
  accountId: string | null; lifeSpent: number;
  vehicleId: string | null; vehicleSeat: number; suppression: number; supportPoints: number; transports: number; skin: SkinId;
  health: number; armor: number; stamina: number; weapon: WeaponId; sight: SightId; muzzle: MuzzleId; grip: GripId; ammo: number; reserve: number;
  primarySight: SightId; primaryMuzzle: MuzzleId; primaryGrip: GripId; paidAttachments: string[];
  primary: WeaponId; secondary: WeaponId; slot: WeaponSlot; primaryAmmo: number; primaryReserve: number; secondaryAmmo: number; secondaryReserve: number;
  reloadUntil: number; healUntil: number; nextShot: number; grenades: number; medkits: number; bags: number;
  class: OperatorClass; xp: number; level: number;
  proneYaw?: number; prone: boolean; throwUntil: number; throwReleased: boolean; crouch: boolean; sprinting: boolean; grounded: boolean;
  parachute: boolean; fallImpact: number;
  state: 'alive' | 'downed' | 'dead';
  respawnAt: number; bleedAt: number; protectedUntil: number; lastDamage: number;
  kills: number; deaths: number; assists: number; revives: number; captures: number; credits: number; earned: number;
  lastAttacker: string | null; reviveProgress: number; seq: number; buildAt: number; pingAt: number;
  bloom: number;
};
export type Cover = { y?:number; supportId?:string; surfaceId?:string; level?:number; id: string; x: number; z: number; w: number; d: number; h: number; health: number; team: Team | null };
export type Construction = Cover & { owner: string; startedAt: number; completeAt: number; originX: number; originY?: number; originZ: number; cost: number };
export type Account = { id: string; username: string; displayName: string; cash: number; kills: number; deaths: number; wins: number; rounds: number; objectiveSeconds: number; assists?: number; xp?: number; level?: number; createdAt: string; email?: string; role?: 'player' | 'admin' };
export type Bullet = Vec3 & { origin?: Vec3; id: number; owner: string; team: Team; vx: number; vy: number; vz: number; life: number; damage: number; distance: number; weapon: WeaponId };
export type Grenade = Vec3 & { id: number; owner: string; team: Team; vx: number; vy: number; vz: number; fuse: number };
export type Crate = Vec3 & { id: number; owner: string; team: Team; vx: number; vy: number; vz: number; life: number };
export type GameEvent = {
  id: number; type: 'purchase' | 'vehicleImpact' | 'nearMiss' | 'shot' | 'hit' | 'kill' | 'down' | 'explosion' | 'grenade' | 'capture' | 'revive' | 'resupply' | 'build' | 'ping' | 'notice' | 'assist' | 'spot' | 'suppression' | 'transport' | 'vehicle';
  time: number; x: number; y: number; z: number; player?: string; target?: string; team?: Team;
  normal?: Vec3; surface?: 'metal'|'wood'|'concrete'|'ground'; decal?: boolean; sight?: SightId; grip?: GripId; queued?: boolean; source?: Vec3; headshot?: boolean; value?: number; weapon?: WeaponId; muzzle?: MuzzleId; message?: string;
};
export type Match = {
  time: number; players: Record<string, Player>; scores: [number, number, number];
  mapId: MapId; phase: MatchPhase; phaseEndsAt: number; matchId: string; constructions: Construction[];
  presence: [number, number, number]; owner: Team | null; captureTeam: Team | null; capture: number;
  contested: boolean; zone: { x: number; z: number; radius: number }; hotZone: { x: number; z: number; radius: number };
  vehicles: Vehicle[]; spots: Spot[];
  covers: Cover[]; bullets: Bullet[]; grenades: Grenade[]; crates: Crate[]; events: GameEvent[];
  winner: Team | null; endAt: number; round: number;
};
export type Snapshot = Omit<Match, 'bullets'> & { bullets: Bullet[] };
export type JoinOptions = { name: string; team: Team; weapon: WeaponId; skin?: SkinId; secondary?: WeaponId; sight?: SightId; muzzle?: MuzzleId; grip?: GripId; class?: OperatorClass; room?: string; botCount?: number; mapId?: MapId; ticket?: string };
export type ClientMessage = { type: 'join'; options: JoinOptions } | { type: 'input'; input: Input }
  | { type: 'loadout'; weapon: WeaponId; sight?: SightId; muzzle?: MuzzleId; grip?: GripId }
  | { type: 'purchase'; weapon: WeaponId; sight?: SightId; muzzle?: MuzzleId; grip?: GripId } | { type: 'skin'; skin: SkinId } | { type: 'ping'; time: number };
export type ServerMessage = { type: 'welcome'; id: string; room: string; state: Snapshot }
  | { type: 'state'; state: Snapshot } | { type: 'error'; message: string } | { type: 'pong'; time: number };
