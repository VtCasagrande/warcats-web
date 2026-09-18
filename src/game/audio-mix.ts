import { direction, eyeHeight, segmentBox } from '../../shared/physics';
import type { Player, Vec3 } from '../../shared/types';
import type { WorldBox } from '../../shared/world';

export const AUDIO_CHANNELS = ['voice','gunfire','movement','vehicles','effects','ambience','music','interface'] as const;
export type AudioChannel = typeof AUDIO_CHANNELS[number];
export type AudioMix = Record<AudioChannel, number> & { spatial: boolean };
export type MenuSound = 'select' | 'weapon' | 'operator' | 'attachment' | 'confirm';
export const DEFAULT_AUDIO: AudioMix = { voice:.65,gunfire:.8,movement:.7,vehicles:.55,effects:.75,ambience:.45,music:.35,interface:.55,spatial:true };
export const AUDIO_LABELS: Record<AudioChannel,string> = { voice:'Voz e rádio',gunfire:'Tiros e recargas',movement:'Passos e equipamento',vehicles:'Motores e rotores',effects:'Impactos e explosões',ambience:'Ambiente',music:'Música',interface:'Menus e seleções' };
export function normalizeAudioMix(value: unknown): AudioMix {
  const raw=value&&typeof value==='object'?value as Record<string,unknown>:{};
  const mix={...DEFAULT_AUDIO};
  for(const key of AUDIO_CHANNELS)if(typeof raw[key]==='number'&&Number.isFinite(raw[key]))mix[key]=Math.max(0,Math.min(1,raw[key]));
  if(typeof raw.spatial==='boolean')mix.spatial=raw.spatial;
  return mix;
}
export function channelForSound(name: string): AudioChannel {
  if(name.startsWith('radio-'))return 'voice';
  if(name.startsWith('music-'))return 'music';
  if(/^(fire-|bullet-|reload-|bolt-action|empty-trigger)/.test(name))return 'gunfire';
  if(/step|cloth|body-fall/.test(name))return 'movement';
  if(/^(jeep-|heli-|gear-shift|tire-skid)/.test(name))return 'vehicles';
  if(/ambience|^wind$/.test(name))return 'ambience';
  return 'effects';
}
export function listenerPose(player: Pick<Player,'x'|'y'|'z'|'yaw'|'pitch'|'crouch'|'state'>) {
  const forward=direction(player.yaw,player.pitch);
  return { position:{x:player.x,y:player.y+eyeHeight(player),z:player.z}, forward,
    up:{x:Math.sin(player.yaw)*Math.sin(player.pitch),y:Math.cos(player.pitch),z:Math.cos(player.yaw)*Math.sin(player.pitch)} };
}
export function soundTravel(point:Vec3,player:Player,boxes:WorldBox[]) {
  const eye=listenerPose(player).position,distance=Math.hypot(point.x-eye.x,point.y-eye.y,point.z-eye.z);
  const blocked=distance>2&&boxes.some(box=>{const t=segmentBox(eye,point,box);return t!==null&&t>.015&&t<.985;});
  return {distance,gain:Math.min(1,12/(distance+5))*(blocked?.38:1),cutoff:blocked?1800:Math.max(1100,18000-distance*65)};
}

export type SoundPosition = number | Vec3;
export function positionSound(node: StereoPannerNode | PannerNode, point:SoundPosition, time:number) {
  if('pan' in node)node.pan.setTargetAtTime(typeof point==='number'?point:0,time,.025);
  else if(typeof point!=='number') { node.positionX.setTargetAtTime(point.x,time,.015);node.positionY.setTargetAtTime(point.y,time,.015);node.positionZ.setTargetAtTime(point.z,time,.015); }
}
