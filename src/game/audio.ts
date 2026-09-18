import { distance2 } from '../../shared/physics';
import { getMap } from '../../shared/maps';
import type { GameEvent, Match, Player, WeaponId, Vec3 } from '../../shared/types';

import { AUDIO_CHANNELS, DEFAULT_AUDIO, channelForSound, listenerPose, normalizeAudioMix, positionSound, soundTravel, type AudioChannel, type AudioMix, type MenuSound, type SoundPosition } from './audio-mix';

type ShotKind = 'ar' | 'smg' | 'lmg' | 'ak' | 'shotgun' | 'pistol' | 'sniper';
const EXPANSION = new Set(['jeep-engine','heli-rotor','wind','harbor-ambience','industrial-ambience','urban-ambience','bullet-crack','bullet-whiz','impact-metal','impact-concrete','glass-break','jeep-start','jeep-stop','jeep-door','heli-start','heli-stop','gear-shift','tire-skid','reload-ar','reload-sniper','reload-pistol','empty-trigger','bolt-action','cloth-step','gravel-step']);
const LOOPS = new Set(['jeep-engine','heli-rotor','wind','harbor-ambience','industrial-ambience','urban-ambience','music-briefing','music-victory','music-defeat']);
const fireKeys = (id: WeaponId):[string,string,string] => [`fire-${id}`,`fire-${id}-2`,`fire-${id}-3`];
const SHOT: Record<WeaponId, { keys: [string, string, string]; kind: ShotKind }> = {
  ar: { keys: fireKeys('ar'), kind: 'ar' },
  smg: { keys: fireKeys('smg'), kind: 'smg' },
  lmg: { keys: fireKeys('lmg'), kind: 'lmg' },
  ak: { keys: fireKeys('ak'), kind: 'ak' },
  dmr: { keys: fireKeys('dmr'), kind: 'ar' },
  shotgun: { keys: fireKeys('shotgun'), kind: 'shotgun' },
  pistol: { keys: fireKeys('pistol'), kind: 'pistol' },
  rpg: { keys: fireKeys('rpg'), kind: 'sniper' },
  knife: { keys: fireKeys('knife'), kind: 'pistol' },
  m40: { keys: fireKeys('m40'), kind: 'sniper' },
  awm: { keys: fireKeys('awm'), kind: 'sniper' },
};
const KIND: Record<ShotKind, { crack: number; body: number; boom: number; high: number; punch: number }> = {
  smg: { crack: .014, body: .05, boom: 140, high: 7800, punch: .9 },
  ar: { crack: .02, body: .07, boom: 105, high: 6400, punch: 1 },
  lmg: { crack: .022, body: .085, boom: 92, high: 5600, punch: 1.08 },
  ak: { crack: .024, body: .09, boom: 78, high: 4700, punch: 1.12 },
  shotgun: { crack: .034, body: .16, boom: 62, high: 4200, punch: 1.25 },
  pistol: { crack: .016, body: .055, boom: 155, high: 6900, punch: .95 },
  sniper: { crack: .045, body: .22, boom: 58, high: 5000, punch: 1.35 },
};
const TAIL: Record<string, number> = {
  'ar-shot': 1.05, 'smg-shot': .65, 'lmg-shot': 1, 'ak-shot': 1.1,
  'shotgun-shot': 1.3, 'pistol-shot': .7, 'sniper-shot': 1.8, explosion: 3,
  'grenade-throw': .9, 'body-fall': .9, 'gravel-step': .34, 'cloth-step': .38,
  build: 4, 'reload-ar': 3, 'reload-sniper': 3.8, 'reload-pistol': 2.2,
  'bullet-crack': .12, 'bullet-whiz': .22, 'jeep-start': 2.5, 'jeep-stop': 2, 'heli-start': 4, 'heli-stop': 3,
};
type LoopVoice = { name: string; source: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode | PannerNode; filter: BiquadFilterNode; synthetic: boolean };
const baseName = (name: string) => name.replace(/-[23]$/, '');
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private wet: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private noise: AudioBuffer | null = null;
  private samples = new Map<string, AudioBuffer>();
  private requested = new Set<string>();
  private queue: string[] = [];
  private loading = 0;
  private loops = new Map<string, LoopVoice>();
  private buildSource: AudioBufferSourceNode | null = null;
  private buildUntil = 0;
  private voices = 0;
  private lastStep = 0;
  private lastImpact = -1;
  private lastSuppression = -1;
  private lastEmpty = -1;
  private lastReload = 0;
  private lastWeapon: WeaponId | null = null;
  private previousSuppression = 0;
  private reloadSource: AudioBufferSourceNode | null = null;
  private riding: string | null = null;
  private lastGear = 0;
  private lastSkid = -1;
  private indoor = false;
  private currentMap: Match['mapId'] = 'nordhaven';
  private vehicleRunning = new Map<string, boolean>();
  private arrivals: {at:number;event:GameEvent}[]=[];
  private deferred: { at: number; name: string; volume: number }[] = [];
  private paused = true;
  private lastTime = 0;
  private phaseKey = '';
  private contested = false;
  private lowAmmo = false;
  private shotVariants = new Map<WeaponId,number>();
  private lastRadio = -10;
  private radioUntil = 0;
  private radioPending: {name:string;priority:number;expires:number}|null = null;
  private buses = new Map<AudioChannel, GainNode>();
  private panners = new Set<PannerNode>();
  private mix: AudioMix = {...DEFAULT_AUDIO};
  private remoteSteps = new Map<string, number>();
  private radioSource: AudioBufferSourceNode | null = null;
  private lastMenu = -1;
  private menuCount = 0;
  volume = .5;

  async enable() {
    if (!this.context) {
      this.context = new AudioContext();
      const ctx = this.context;
      this.master = ctx.createGain(); this.master.gain.value = this.volume;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14; compressor.knee.value = 12; compressor.ratio.value = 3;
      compressor.attack.value = .003; compressor.release.value = .18;
      this.master.connect(compressor); compressor.connect(ctx.destination);
      for(const channel of AUDIO_CHANNELS){const bus=ctx.createGain();bus.gain.value=this.mix[channel];bus.connect(this.master);this.buses.set(channel,bus);}
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const channel = this.noise.getChannelData(0);
      for (let i = 0; i < channel.length; i++) channel[i] = Math.random() * 2 - 1;
      // One short shared room response; send level follows whether the listener is indoors.
      this.reverb = ctx.createConvolver();
      const impulse = ctx.createBuffer(2, Math.floor(ctx.sampleRate * .38), ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const data = impulse.getChannelData(c);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3.5) * .25;
      }
      this.reverb.buffer = impulse;
      this.wet = ctx.createGain(); this.wet.gain.value = .025;
      this.reverb.connect(this.wet); this.wet.connect(this.master);
      for(const channel of ['gunfire','movement','effects'] as AudioChannel[])this.buses.get(channel)!.connect(this.reverb);
      this.prepareWeapon('ar'); this.request('bullet-crack'); this.request('bullet-whiz');
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }

  /** Assets are requested on use, with two decodes in flight and no eager library download. */
  private request(name: string) {
    if (!this.context || this.requested.has(name)) return;
    this.requested.add(name); this.queue.push(name); this.pump();
  }
  private pump() {
    const ctx = this.context; if (!ctx) return;
    while (this.loading < 2 && this.queue.length) {
      const name = this.queue.shift()!; this.loading++;
      const base = baseName(name), root = EXPANSION.has(base) || /^(fire|radio|music)-/.test(base) ? '/assets/magnific/expansion/audio/' : '/assets/magnific/';
      void fetch(`${root}${name}.mp3`).then(async response => {
        if (!response.ok) return;
        const decoded = await ctx.decodeAudioData(await response.arrayBuffer());
        const buffer = LOOPS.has(base) ? this.loopBuffer(ctx, decoded) : this.trim(ctx, decoded, base.startsWith('radio-') ? 12 : base.startsWith('fire-') ? base==='fire-m40'||base==='fire-awm' ? .85 : base==='fire-rpg' ? 1.2 : base==='fire-knife' ? .3 : base==='fire-shotgun' ? .5 : .32 : TAIL[base] ?? 1.2);
        if (buffer) this.samples.set(name, buffer);
      }).catch(() => { /* Procedural sound remains available if an optional sample fails. */ })
        .finally(() => { this.loading--; this.pump(); });
    }
  }
  private loopBuffer(ctx: AudioContext, original: AudioBuffer) {
    const length = Math.min(original.length, Math.floor(original.sampleRate * 16));
    const result = ctx.createBuffer(original.numberOfChannels, length, original.sampleRate);
    const fade = Math.min(Math.floor(original.sampleRate * .035), Math.floor(length / 4));
    for (let c = 0; c < original.numberOfChannels; c++) {
      const data = new Float32Array(original.getChannelData(c).subarray(0, length));
      // Remove a hard discontinuity at the boundary without trimming quiet ambience.
      for (let i = 0; i < fade; i++) { data[i] *= i / fade; data[length - 1 - i] *= i / fade; }
      result.copyToChannel(data, c);
    }
    return result;
  }
  private trim(ctx: AudioContext, buffer: AudioBuffer, maxSeconds: number) {
    const data = buffer.getChannelData(0), limit = Math.min(data.length, Math.floor(buffer.sampleRate * .55));
    let start = 0; while (start < limit && Math.abs(data[start]) < .015) start++;
    start = Math.max(0, start - Math.floor(buffer.sampleRate * .002));
    let peak = 0; for (let i = start; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    if (peak < .008) return null;
    const length = Math.min(buffer.length - start, Math.floor(buffer.sampleRate * maxSeconds));
    if (length < 32) return null;
    const cropped = ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const copy = new Float32Array(buffer.getChannelData(channel).subarray(start, start + length));
      const fade = Math.min(Math.floor(buffer.sampleRate * .045), Math.floor(length * .12));
      for (let i = 0; i < fade; i++) copy[length - 1 - i] *= i / fade;
      const normalize=Math.min(1.4,.82/peak);
      for(let i=0;i<copy.length;i++)copy[i]*=normalize;
      cropped.copyToChannel(copy, channel);
    }
    return cropped;
  }
  private sample(name: string, volume: number, pan: SoundPosition = 0, rate = 1, cutoff = 18000) {
    this.request(name);
    const ctx = this.context, buffer = this.samples.get(name);
    if (!ctx || ctx.state !== 'running' || !buffer || !this.master || !this.volume || this.voices >= (typeof pan==='number'?32:24) || volume < .003) return null;
    const source = ctx.createBufferSource(); source.buffer = buffer; source.playbackRate.value = rate;
    const gain = ctx.createGain(); gain.gain.value = volume;
    const stereo = this.spatialNode(pan);
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = cutoff;
    source.connect(gain); gain.connect(filter); filter.connect(stereo); stereo.connect(this.buses.get(channelForSound(name))!);
    this.voices++;
    source.onended = () => { this.voices--; source.disconnect(); gain.disconnect(); filter.disconnect(); stereo.disconnect(); if(stereo instanceof PannerNode)this.panners.delete(stereo); };
    source.start(); return source;
  }
  private loop(id: string, name: string, volume: number, pan: SoundPosition = 0, rate = 1, cutoff = 18000) {
    const ctx = this.context; if (!ctx || !this.master || !this.noise) return;
    this.request(name);
    let current = this.loops.get(id);
    const buffer = this.samples.get(name);
    if (current && (current.name !== name || current.synthetic && buffer || (typeof pan==='number') !== ('pan' in current.pan))) { this.stopLoop(id); current = undefined; }
    if (!current) {
      if (this.loops.size >= 5) return;
      if(name.startsWith('music-') && !buffer)return;
      const synthetic = !buffer;
      // Quiet filtered noise is a temporary fallback; ambience never blocks play on network loading.
      const source = ctx.createBufferSource(); source.buffer = buffer ?? this.noise; source.loop = true;
      const gain = ctx.createGain(); gain.gain.value = 0;
      const stereo = this.spatialNode(pan), filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
      source.connect(filter); filter.connect(gain); gain.connect(stereo); stereo.connect(this.buses.get(channelForSound(name))!);
      current = { name, source, gain, pan: stereo, filter, synthetic };
      this.loops.set(id, current);
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); stereo.disconnect(); if(stereo instanceof PannerNode)this.panners.delete(stereo); };
      source.start();
    }
    current.gain.gain.setTargetAtTime(volume * (current.synthetic ? .28 : 1), ctx.currentTime, .09);
    positionSound(current.pan,pan,ctx.currentTime);
    current.source.playbackRate.setTargetAtTime(clamp(rate, .45, 1.9), ctx.currentTime, .14);
    current.filter.frequency.setTargetAtTime(current.synthetic ? name === 'heli-rotor' ? 210 : name === 'jeep-engine' ? 150 : 650 : cutoff, ctx.currentTime, .1);
  }
  private stopLoop(id: string) {
    const current = this.loops.get(id), ctx = this.context; if (!current || !ctx) return;
    current.gain.gain.setTargetAtTime(0, ctx.currentTime, .045); current.source.stop(ctx.currentTime + .18); this.loops.delete(id);
  }
  private spatialNode(point: SoundPosition): StereoPannerNode | PannerNode {
    const ctx=this.context!;
    if(typeof point==='number'){const node=ctx.createStereoPanner();node.pan.value=clamp(point,-1,1);return node;}
    const node=ctx.createPanner();node.panningModel=this.mix.spatial?'HRTF':'equalpower';
    node.distanceModel='inverse';node.refDistance=12;node.maxDistance=350;node.rolloffFactor=0;
    // World distance/occlusion is applied once in soundTravel; the panner handles XYZ direction.
    node.positionX.value=point.x;node.positionY.value=point.y;node.positionZ.value=point.z;
    this.panners.add(node);return node;
  }
  private updateListener(player:Player) {
    const ctx=this.context;if(!ctx)return;const pose=listenerPose(player),listener=ctx.listener,t=ctx.currentTime;
    for(const [key,v] of Object.entries(pose.position)) (listener[('position'+key.toUpperCase()) as 'positionX'] as AudioParam).setTargetAtTime(v,t,.015);
    for(const [key,v] of Object.entries(pose.forward)) (listener[('forward'+key.toUpperCase()) as 'forwardX'] as AudioParam).setTargetAtTime(v,t,.015);
    for(const [key,v] of Object.entries(pose.up)) (listener[('up'+key.toUpperCase()) as 'upX'] as AudioParam).setTargetAtTime(v,t,.015);
  }
  setMix(value:AudioMix) {
    this.mix=normalizeAudioMix(value);
    if(!this.mix.voice){this.radioSource?.stop();this.radioSource=null;this.radioPending=null;}
    if(this.context)for(const channel of AUDIO_CHANNELS)this.buses.get(channel)?.gain.setTargetAtTime(this.mix[channel],this.context.currentTime,.025);
    for(const node of this.panners)node.panningModel=this.mix.spatial?'HRTF':'equalpower';
  }
  prepareWeapon(id:WeaponId){for(const key of SHOT[id].keys)this.request(key);this.request(id==='m40'||id==='awm'?'reload-sniper':id==='pistol'?'reload-pistol':'reload-ar');}
  async menu(cue:MenuSound='select') {
    await this.enable();const ctx=this.context!;if(ctx.currentTime-this.lastMenu<.045)return;this.lastMenu=ctx.currentTime;
    this.menuCount++;
    this.burst(.025,.025,2400,0,'bandpass',.7,'interface');
    if(cue==='weapon'||cue==='attachment')this.thump(cue==='weapon'?210:320,.075,.055,0,'interface');
    else if(cue==='operator')this.tone(520,.06,.025,'interface');
    else if(cue==='confirm')this.tone(740,.09,.035,'interface');
  }
  get stats() {return {volume:this.volume,mix:{...this.mix},voices:this.voices,spatialSources:this.panners.size,loadedSamples:this.samples.size,menuSounds:this.menuCount};}

  world(state: Match, player: Player | undefined, paused: boolean, _dt: number) {
    this.currentMap = state.mapId; if(player)this.updateListener(player);
    if(paused||!player){this.radioSource?.stop();this.radioSource=null;this.radioPending=null;}
    if(state.time<this.lastTime) {
      this.lastStep=0;this.lastImpact=this.lastSuppression=this.lastEmpty=this.lastSkid=-1;
      this.remoteSteps.clear();this.lastWeapon=null;this.riding=null;this.vehicleRunning.clear();this.deferred.length=0;this.arrivals.length=0;this.phaseKey='';
    }
    this.lastTime=state.time;
    const results=state.phase==='results'||state.phase==='intermission';
    const phaseKey=player?`${state.matchId}:${state.phase}`:'menu';
    if(phaseKey!==this.phaseKey) {
      this.phaseKey=phaseKey;
      if(player&&state.phase==='active')this.radio('start',2);
      if(player&&state.phase==='results'&&state.winner!==null)this.radio(state.winner===player.team?'victory':'defeat',3);
      if(player&&state.phase==='warmup')this.request('radio-start');
    }
    if(!paused)this.flushRadio();
    this.paused = paused || !player || player.state === 'dead' || results;
    if (this.paused || !this.volume || this.context?.state !== 'running') {
      for (const id of this.loops.keys()) if(id!=='music')this.stopLoop(id);
      const music=!player||paused||results;
      if(music&&this.volume&&this.context?.state==='running')this.loop('music',results&&player&&state.winner!==null?state.winner===player.team?'music-victory':'music-defeat':'music-briefing',.065);
      else this.stopLoop('music');
      this.deferred.length = 0; this.arrivals.length=0; this.lastReload = 0;
      this.reloadSource?.stop(); this.reloadSource = null;
      return;
    }
    const me = player!, ctx = this.context!;
    this.stopLoop('music');
    if(state.contested&&!this.contested)this.radio('contested',1);
    this.contested=state.contested;
    if(me.ammo>0&&me.ammo<=3&&!this.lowAmmo)this.radio('lowammo');
    this.lowAmmo=me.ammo<=3;
    if(me.vehicleId!==this.riding&&me.vehicleId)this.radio('boarding');
    if(me.weapon!==this.lastWeapon) {
      this.lastWeapon=me.weapon;
      for(const key of SHOT[me.weapon].keys)this.request(key);
      this.request(me.weapon==='m40'||me.weapon==='awm'?'reload-sniper':me.weapon==='pistol'?'reload-pistol':'reload-ar');
      this.request('empty-trigger');
    }
    if(me.buildMode)this.request('build');
    this.indoor = getMap(state.mapId).buildings.some(b => Math.abs(me.x-b.x) < b.w/2 && Math.abs(me.z-b.z) < b.d/2 && me.y < b.height-1.2);
    this.wet?.gain.setTargetAtTime(this.indoor ? .08 : .012, ctx.currentTime, .25);
    const wanted = new Set(['wind','ambience']);
    this.loop('wind','wind',this.indoor ? .016 : .055);
    this.loop('ambience',state.mapId === 'harbor' ? 'harbor-ambience' : state.mapId === 'quarry' ? 'industrial-ambience' : 'urban-ambience',this.indoor ? .025 : .055);
    const nearby = (state.vehicles ?? []).filter(v => v.health > 0 && (v.seats[0] && v.fuel>0 || v.y>.2 || Math.abs(v.speed) > .2))
      .map(v => ({v,distance:Math.hypot(v.x-me.x,v.z-me.z,(v.y-me.y))}))
      .filter(({v,distance}) => distance < (v.kind === 'helicopter' ? 210 : 105)).sort((a,b) => a.distance-b.distance).slice(0,3);
    for (const {v,distance} of nearby) {
      const riding = me.vehicleId === v.id, helicopter = v.kind === 'helicopter', id = `vehicle:${v.id}`;
      wanted.add(id);
      const attenuation = riding ? 1 : Math.min(1,(helicopter ? 23 : 12)/(distance+10));
      this.loop(id,helicopter ? 'heli-rotor' : 'jeep-engine',(helicopter ? .28 : .22)*attenuation,riding ? 0 : {x:v.x,y:v.y+1.7,z:v.z},helicopter ? (.65+(v.rotorSpeed??1)*.35) : .75+Math.abs(v.speed)/37,riding ? 7000 : Math.max(850,12000-distance*58));
    }
    for(const id of this.loops.keys())if(!wanted.has(id))this.stopLoop(id);
    const present = new Set<string>();
    for (const v of state.vehicles ?? []) {
      present.add(v.id);
      const running = !!v.seats[0] && v.health > 0, was = this.vehicleRunning.get(v.id);
      if (was !== undefined && was !== running && distance2(v,me) < 55) this.sample(`${v.kind === 'jeep' ? 'jeep' : 'heli'}-${running ? 'start' : 'stop'}`,.22*Math.min(1,15/(distance2(v,me)+5)),{x:v.x,y:v.y+1.2,z:v.z});
      this.vehicleRunning.set(v.id,running);
    }
    for(const id of this.vehicleRunning.keys())if(!present.has(id))this.vehicleRunning.delete(id);
    if (me.vehicleId !== this.riding) {
      if (me.vehicleId || this.riding) this.sample('jeep-door',.28);
      this.riding = me.vehicleId; this.lastGear = 0;
    }
    const vehicle = state.vehicles?.find(v => v.id === me.vehicleId);
    if(vehicle?.kind === 'jeep') {
      const speed = Math.abs(vehicle.speed), gear = Math.min(4,Math.floor(speed/7));
      if(gear!==this.lastGear && gear>0)this.sample('gear-shift',.13);
      if(speed>10 && Math.abs(vehicle.roll)>.08 && state.time-this.lastSkid>1.8){this.lastSkid=state.time;this.sample('tire-skid',.14);}
      this.lastGear=gear;
    }
    const reload=me.reloadUntil;
    if(reload && reload!==this.lastReload) {
      this.reloadSource?.stop();
      const key=me.weapon==='m40'||me.weapon==='awm'?'reload-sniper':me.weapon==='pistol'?'reload-pistol':'reload-ar';
      this.reloadSource=this.sample(key,.3);
      if(!this.reloadSource){this.burst(.07,.04,2600,0,'highpass',.7,'gunfire');this.thump(180,.05,.035,0,'gunfire');}
    } else if(!reload && this.lastReload){this.reloadSource?.stop();this.reloadSource=null;}
    this.lastReload=reload;
    const closeSteps=Object.values(state.players).filter(p=>p.id!==me.id&&p.state==='alive'&&!p.vehicleId&&p.grounded&&Math.hypot(p.vx,p.vz)>.5&&distance2(p,me)<24).sort((a,b)=>distance2(a,me)-distance2(b,me)).slice(0,6);
    for(const p of closeSteps)if(state.time-(this.remoteSteps.get(p.id)??-1)>(p.sprinting?.3:.46)){
      this.remoteSteps.set(p.id,state.time);const point={x:p.x,y:p.y+.1,z:p.z},travel=soundTravel(point,me,getMap(state.mapId).boxes);
      this.sample('gravel-step',.13*travel.gain,point,1,travel.cutoff);
    }
    for(const id of this.remoteSteps.keys())if(!state.players[id])this.remoteSteps.delete(id);
    for(let i=this.arrivals.length-1;i>=0;i--)if(this.arrivals[i].at<=state.time){const sound=this.arrivals.splice(i,1)[0];this.event(sound.event,me,true);}
    for(let i=this.deferred.length-1;i>=0;i--)if(this.deferred[i].at<=state.time){const sound=this.deferred.splice(i,1)[0];this.sample(sound.name,sound.volume);}
  }
  private radio(key: string, priority=0) {
    const ctx=this.context;if(!ctx||!this.mix.voice)return;
    const name=`radio-${key}`;this.request(name);
    if(this.radioPending&&this.radioPending.priority>priority)return;
    this.radioPending={name,priority,expires:ctx.currentTime+8};
    this.flushRadio();
  }
  private flushRadio() {
    const ctx=this.context,pending=this.radioPending;if(!ctx||!pending)return;
    if(ctx.currentTime>pending.expires){this.radioPending=null;return;}
    if(ctx.currentTime<this.lastRadio+4||ctx.currentTime<this.radioUntil+.15||!this.samples.has(pending.name))return;
    const source=this.sample(pending.name,.24,0,1,5000);
    if(source){this.radioSource=source;
      this.lastRadio=ctx.currentTime;this.radioUntil=ctx.currentTime+this.samples.get(pending.name)!.duration;
      this.radioPending=null;
    }
  }
  construction(player: Player | undefined, paused: boolean) {
    const until = paused ? 0 : player?.buildUntil ?? 0; if (until === this.buildUntil) return; this.buildUntil = until;
    this.buildSource?.stop(); this.buildSource = null;
    if (until) this.buildSource = this.sample('build', .22);
  }
  setVolume(value: number) { this.volume = clamp(value,0,1); if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume,this.context.currentTime,.025); }
  private routed(pan: SoundPosition, channel: AudioChannel='effects') {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.noise || !this.master || this.volume === 0 || this.voices >= 40) return null;
    const stereo = this.spatialNode(pan); stereo.connect(this.buses.get(channel)!);
    this.voices++; return { ctx, stereo };
  }
  private burst(duration: number, volume: number, frequency: number, pan: SoundPosition = 0, type: BiquadFilterType = 'lowpass', q = .7, channel:AudioChannel='effects') {
    const route = this.routed(pan,channel); if (!route) return;
    const noise = route.ctx.createBufferSource(); noise.buffer = this.noise;
    const filter = route.ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
    const gain = route.ctx.createGain(); gain.gain.setValueAtTime(Math.max(.001,volume),route.ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001,route.ctx.currentTime+duration);
    noise.connect(filter); filter.connect(gain); gain.connect(route.stereo); noise.start(); noise.stop(route.ctx.currentTime+duration);
    noise.onended = () => { this.voices--; noise.disconnect(); filter.disconnect(); gain.disconnect(); route.stereo.disconnect(); if(route.stereo instanceof PannerNode)this.panners.delete(route.stereo); };
  }
  private thump(frequency: number, duration: number, volume: number, pan: SoundPosition = 0, channel:AudioChannel='effects') {
    const route = this.routed(pan,channel); if (!route) return;
    const osc = route.ctx.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(frequency,route.ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(Math.max(28,frequency*.45),route.ctx.currentTime+duration);
    const gain = route.ctx.createGain(); gain.gain.setValueAtTime(Math.max(.001,volume),route.ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001,route.ctx.currentTime+duration);
    osc.connect(gain); gain.connect(route.stereo); osc.start(); osc.stop(route.ctx.currentTime+duration);
    osc.onended = () => { this.voices--; osc.disconnect(); gain.disconnect(); route.stereo.disconnect(); if(route.stereo instanceof PannerNode)this.panners.delete(route.stereo); };
  }
  private gunshot(kind: ShotKind, volume: number, pan: SoundPosition) {
    const p = KIND[kind];
    this.burst(p.crack,volume*1.15*p.punch,p.high,pan,'highpass',.5,'gunfire');
    this.burst(p.body,volume*.85*p.punch,420,pan,'bandpass',.85,'gunfire');
    this.thump(p.boom,p.body*1.4,volume*.45*p.punch,pan,'gunfire');
  }
  tone(frequency: number, duration = .08, volume = .08, channel:AudioChannel='effects') {
    const route = this.routed(0,channel); if (!route) return;
    const osc = route.ctx.createOscillator(); osc.frequency.value = frequency;
    const gain = route.ctx.createGain(); gain.gain.setValueAtTime(volume,route.ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001,route.ctx.currentTime+duration);
    osc.connect(gain); gain.connect(route.stereo); osc.start(); osc.stop(route.ctx.currentTime+duration);
    osc.onended = () => { this.voices--; osc.disconnect(); gain.disconnect(); route.stereo.disconnect(); if(route.stereo instanceof PannerNode)this.panners.delete(route.stereo); };
  }
  emptyTrigger(time: number) {
    if(time-this.lastEmpty<.28)return; this.lastEmpty=time;
    if(!this.sample('empty-trigger',.19))this.burst(.025,.04,2300,0,'bandpass',.7,'gunfire');
  }
  event(event: GameEvent, player: Player, arrived=false) {
    void this.enable();
    this.updateListener(player);
    const travel=soundTravel(event,player,getMap(this.currentMap).boxes),distance=travel.distance, own = event.player === player.id;
    const pan:SoundPosition = own && event.type==='shot' ? 0 : {x:event.x,y:event.y,z:event.z}, near = own&&event.type==='shot' ? 1 : travel.gain;
    if(distance>230 && !own && event.type!=='capture')return;
    const cutoff = own&&event.type==='shot' ? 18000 : travel.cutoff;
    if(!arrived&&event.type==='shot'&&!own&&event.weapon!=='knife'&&event.time+distance/343>this.lastTime+.01){if(this.arrivals.length<48)this.arrivals.push({at:event.time+distance/343,event:{...event}});this.prepareWeapon(event.weapon??'ar');return;}
    if(event.type==='shot') {
      const weapon=event.weapon??player.weapon, config=SHOT[weapon], volume=(own?.57:.36*near)*(.96+Math.random()*.08);
      const variant=((this.shotVariants.get(weapon)??Math.floor(Math.random()*3))+1+Math.floor(Math.random()*2))%3;
      this.shotVariants.set(weapon,variant);
      const key=config.keys[variant], suppressed=event.muzzle==='supp';
      if(weapon==='knife'){this.sample(key,volume*.6,pan);this.thump(210,.1,volume*.15,pan,'gunfire');return;}
      const sample=this.sample(key,volume*(suppressed?.38:.85),pan,(.97+Math.random()*.06)*(suppressed?.92:1),cutoff);
      // Natural tails supply the body when decoded; procedural layers preserve an immediate trigger response.
      if(!sample)this.gunshot(config.kind,volume*.55*(suppressed?.42:event.muzzle==='comp'?1.06:1),pan);
      for(const name of config.keys)this.request(name);
      if(own&&(weapon==='m40'||weapon==='awm')&&this.deferred.length<8){this.request('bolt-action');this.deferred.push({at:event.time+.32,name:'bolt-action',volume:.23});}
    }
    if(event.type==='vehicleImpact'){const gain=Math.min(.5,(event.value??0)/35)*(player.vehicleId===event.target?1:near);this.sample('impact-metal',gain,pan,.8,cutoff);this.thump(65,.15,gain*.4,pan,'vehicles');}
    if(event.type==='grenade'){this.sample('grenade-throw',own?.5:.22*near,pan);this.burst(.12,own?.16:.08*near,1800,pan,'highpass');}
    if(event.type==='explosion') {
      const volume=Math.min(own?.85:.75,16/(distance+4));
      const sample=this.sample(Math.random()<.5?'explosion':'explosion-2',volume,pan,.94+Math.random()*.08,cutoff);
      this.thump(48,.55,volume*.6,pan);this.burst(.7,volume*(sample?.25:.75),380,pan);this.burst(.18,volume*.35,2400,pan,'highpass');
    }
    if(event.type==='down'){this.sample(Math.random()<.5?'body-fall':'body-fall-2',own?.6:.35*near,pan);this.thump(70,.22,own?.2:.1*near,pan);}
    if(event.type==='hit' && !event.target && distance<85 && event.time-this.lastImpact>.04) {
      this.lastImpact=event.time;
      const box=getMap(this.currentMap).boxes.find(b=>Math.abs(event.x-b.x)<=b.w/2+.2&&Math.abs(event.y-b.y)<=b.h/2+.2&&Math.abs(event.z-b.z)<=b.d/2+.2);
      const metal=event.surface ? event.surface==='metal' : box && ['metal','rust','dark'].includes(box.material), name=metal?'impact-metal':'impact-concrete';
      const impactNear=Math.min(1,10/(distance+5));
      if(!this.sample(name,.24*impactNear,pan,1,cutoff))this.burst(.055,.1*impactNear,metal?3200:850,pan,'bandpass');
    }
    if(event.type==='nearMiss' && event.target===player.id && event.time-this.lastSuppression>.10) {
      this.lastSuppression=event.time;
      const volume=.2+Math.max(0,1-(event.value??1)/1.8)*.15;
      if(!this.sample((event.weapon==='pistol'||event.weapon==='smg')?'bullet-whiz':'bullet-crack',volume,pan,1,14000))this.burst(.06,volume*.5,4500,pan,'highpass',.7,'gunfire');
    }
    if(event.type==='hit' && event.target && own)this.tone(event.headshot?1300:920,.055,.08);
    if(event.type==='kill' && own){this.thump(210,.08,.07);this.tone(760,.12,.1);this.tone(1180,.16,.05);}
    if(event.type==='capture'){this.tone(440,.35,.06);if(event.team===player.team)this.radio('capture',1);}
    if(event.type==='revive' && (own||event.target===player.id)){this.tone(660,.25,.08);this.radio('revive');}
    if(event.type==='spot' && own){this.burst(.07,.025,2200,0,'bandpass');this.tone(850,.08,.045);this.radio('spot');}
    if(event.type==='transport' && own){this.tone(520,.18,.065);this.tone(780,.25,.04);this.radio('transport',1);}
    if(event.type==='vehicle'&&own&&event.message?.includes('Desembarque'))this.radio('landing');
    if(event.type==='suppression'&&own)this.radio('suppression');
  }
  footstep(time: number, moving: boolean, sprint: boolean, grounded: boolean) {
    if(this.paused || this.riding)return;
    if(moving && grounded && time-this.lastStep>(sprint?.29:.43)) {
      this.lastStep=time;
      const volume=sprint?.14:.085,key=this.indoor?'cloth-step':Math.random()<.5?'gravel-step':'gravel-step-2';
      if(!this.sample(key,volume,0,.94+Math.random()*.12))this.burst(.07,volume,420,0,'lowpass',.7,'movement');
      if(this.indoor)this.thump(130,.035,volume*.24,0,'movement');
    }
  }
}
