import { emptyInput, type Input, type Player } from '../../shared/types';
import { WEAPONS } from '../../shared/config';
import { clamp } from '../../shared/physics';
import { equipped } from '../../shared/loadout';

const blockedKeys = ['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
export class Controls {
  input: Input = emptyInput();
  keys = new Set<string>();
  active = false;
  sensitivity = 1;
  adsMultiplier = 1;
  mouseAccel = 0;
  invertY = false;
  parachuteAuto = true;
  locked = false;
  touch = matchMedia('(pointer: coarse)').matches;
  onPause = () => {};
  onScoreboard = (_show: boolean) => {};
  onMap = () => {};
  private mouseDown = false;
  private lockPending = false;
  private lockFailed = false;
  private touchMove = { x: 0, y: 0 };
  private player?: Player;
  private actionKeys: Record<string, keyof Input> = { KeyR: 'reload', KeyH: 'heal', KeyG: 'grenade', KeyB: 'build', KeyQ: 'ping', KeyE: 'vehicle' };

  constructor(private canvas: HTMLCanvasElement) {
    document.addEventListener('pointerlockchange', () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (wasLocked && !this.locked && this.active) { this.clear(); this.onPause(); }
    });
    document.addEventListener('keydown', e => {
      if (!this.active) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (blockedKeys.includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === 'Escape') this.onPause();
      if (e.code === 'Tab') this.onScoreboard(true);
      if (e.code === 'KeyM') this.onMap();
      if (e.code === 'KeyZ' && !this.player?.vehicleId) this.input.prone = !this.player?.prone;
      if (e.code === 'Space' && !this.player?.vehicleId) this.input.jump = true;
      if (e.code === 'Digit1' || e.code === 'Numpad1') this.input.equip = 0;
      if (e.code === 'Digit2' || e.code === 'Numpad2') this.input.equip = 1;
      if (e.code === 'Digit3' || e.code === 'Numpad3') this.input.equip = 2;
      if (e.code === 'KeyR' && this.player?.buildMode) { this.input.rotate = true; return; }
      const action = this.actionKeys[e.code];
      if (action) (this.input[action] as boolean) = true;
    });
    document.addEventListener('keyup', e => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.onScoreboard(false);
    });
    document.addEventListener('mousemove', e => {
      if (!this.active || !(this.locked || this.mouseDown)) return;
      this.look(e.movementX, e.movementY);
    });
    canvas.addEventListener('mousedown', e => {
      if (!this.active) return;
      this.mouseDown = true;
      if (!this.touch && !this.locked && !this.lockFailed) {
        this.input.fire = false; this.input.aim = false;
        void this.lock();
        return;
      }
      if (e.button === 0) { if (this.player?.buildMode) this.input.place = true; else this.input.fire = true; }
      if (e.button === 2) { if (this.player?.buildMode || this.player?.buildUntil) { this.input.cancel = true; this.input.aim = false; } else this.input.aim = true; }
    });
    document.addEventListener('mouseup', e => {
      this.mouseDown = false;
      if (e.button === 0) this.input.fire = false;
      if (e.button === 2) this.input.aim = false;
    });
    document.addEventListener('contextmenu', e => { if (this.active) e.preventDefault(); });
    canvas.addEventListener('wheel', e => {
      if (!this.active || !this.input.aim || !this.player || this.player.vehicleId || !equipped(this.player).optic) return;
      e.preventDefault(); this.input.zoom = true;
    }, { passive: false });
    window.addEventListener('blur', () => { this.clear(); if (this.active) this.onPause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.clear(); if (this.active) this.onPause(); } });
  }
  setPlayer(player?: Player) { this.player = player; }
  look(x: number, y: number) {
    const zoom = this.player && !this.player.vehicleId && this.input.aim && !this.player.reloadUntil && !this.player.buildMode
      ? this.player.scopeZoom || WEAPONS[this.player.weapon].scope : 1;
    const ads = this.player && this.input.aim && !this.player.vehicleId ? this.adsMultiplier : 1;
    const accel = 1 + this.mouseAccel * Math.min(1.8, Math.hypot(x, y) / 28);
    const sensitivity = 0.00165 * this.sensitivity * ads * accel / Math.max(1, zoom);
    this.input.yaw -= x * sensitivity;
    this.input.pitch = clamp(this.input.pitch - y * sensitivity * (this.invertY ? -1 : 1), -1.45, 1.45);
  }
  clear() {
    const { yaw, pitch, seq } = this.input;
    this.input = { ...emptyInput(), yaw, pitch, seq, prone: this.player?.prone ?? false };
    this.keys.clear(); this.mouseDown = false; this.touchMove = { x: 0, y: 0 };
  }
  async lock() {
    if (this.touch || this.lockPending || document.pointerLockElement === this.canvas) return;
    this.lockPending = true;
    try { await this.canvas.requestPointerLock(); this.lockFailed = false; }
    catch { this.lockFailed = true; /* Click-drag look remains available when a browser denies pointer lock. */ }
    finally { this.lockPending = false; }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  sample(): Input {
    const i = this.input;
    i.forward = clamp(+(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - +(this.keys.has('KeyS') || this.keys.has('ArrowDown')) - this.touchMove.y, -1, 1);
    i.strafe = clamp(+(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - +(this.keys.has('KeyA') || this.keys.has('ArrowLeft')) + this.touchMove.x, -1, 1);
    i.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchMove.y < -0.9;
    i.steady = i.sprint && i.aim;
    if (i.aim) i.sprint = false;
    if (!this.touch) { i.crouch = this.keys.has('KeyC') || this.keys.has('ControlLeft'); i.interact = this.keys.has('KeyF'); }
    if(!this.touch)i.brake=this.keys.has('KeyX');
    if (this.player?.buildMode) i.fire = false;
    if (this.player?.vehicleId) {
      i.ascend = this.touch ? i.ascend : this.keys.has('Space');
      i.descend = this.touch ? i.descend : this.keys.has('KeyC') || this.keys.has('ControlLeft') || this.keys.has('ControlRight');
      i.jump = false; i.crouch = false; i.prone = false; i.sprint = false; i.steady = false; i.fire = false; i.aim = false; i.equip = -1;
      i.reload = false; i.heal = false; i.grenade = false; i.build = false; i.place = false; i.zoom = false;
    } else { i.ascend = false; i.descend = false; }
    i.parachute = !this.player?.vehicleId && !this.player?.grounded && (
      this.keys.has('Space') || (this.parachuteAuto && (this.player?.y ?? 0) > 8 && (this.player?.vy ?? 0) < -6)
    );
    return { ...i };
  }
  consume() {
    this.input.seq++;
    for (const key of ['reload', 'heal', 'grenade', 'build', 'ping', 'jump', 'place', 'rotate', 'cancel', 'zoom', 'vehicle'] as const) this.input[key] = false;
    this.input.equip = -1;
  }
  bindTouch(root: HTMLElement) {
    const joystick = root.querySelector<HTMLElement>('#joystick')!;
    const knob = root.querySelector<HTMLElement>('#joystick-knob')!;
    let joyPointer = -1, lookPointer = -1, lookX = 0, lookY = 0;
    const updateJoy = (event: PointerEvent) => {
      const rect = joystick.getBoundingClientRect();
      let x = event.clientX - rect.left - rect.width / 2, y = event.clientY - rect.top - rect.height / 2;
      const length = Math.hypot(x, y);
      if (length > 42) { x *= 42 / length; y *= 42 / length; }
      this.touchMove = { x: x / 42, y: y / 42 }; knob.style.transform = `translate(${x}px, ${y}px)`;
    };
    joystick.addEventListener('pointerdown', e => { if (joyPointer !== -1) return; joyPointer = e.pointerId; joystick.setPointerCapture(e.pointerId); updateJoy(e); });
    joystick.addEventListener('pointermove', e => { if (e.pointerId === joyPointer) updateJoy(e); });
    const resetJoy = (e: PointerEvent) => { if (e.pointerId !== joyPointer) return; joyPointer = -1; this.touchMove = { x: 0, y: 0 }; knob.style.transform = ''; };
    joystick.addEventListener('pointerup', resetJoy); joystick.addEventListener('pointercancel', resetJoy);
    const look = root.querySelector<HTMLElement>('#touch-look')!;
    look.addEventListener('pointerdown', e => { if (lookPointer !== -1) return; lookPointer = e.pointerId; lookX = e.clientX; lookY = e.clientY; look.setPointerCapture(e.pointerId); });
    look.addEventListener('pointermove', e => { if (e.pointerId === lookPointer) { this.look((e.clientX - lookX) * 1.8, (e.clientY - lookY) * 1.8); lookX = e.clientX; lookY = e.clientY; } });
    const endLook = (e: PointerEvent) => { if (e.pointerId === lookPointer) lookPointer = -1; };
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);
    root.querySelectorAll<HTMLButtonElement>('[data-touch]').forEach(button => {
      const action = button.dataset.touch as keyof Input;
      button.addEventListener('pointerdown', e => {
        e.preventDefault(); button.setPointerCapture(e.pointerId);
        if (this.player?.vehicleId && (action === 'jump' || action === 'crouch')) { this.input[action === 'jump' ? 'ascend' : 'descend'] = true; return; }
        if (action === 'aim' && this.player?.buildUntil) { this.input.cancel = true; this.input.aim = false; return; }
        if (this.player?.buildMode && ['fire', 'reload', 'aim'].includes(action)) {
          this.input[action === 'fire' ? 'place' : action === 'reload' ? 'rotate' : 'cancel'] = true; return;
        }
        (this.input[action] as boolean) = action === 'aim' || action === 'crouch' || action === 'prone' ? !this.input[action] : true;
      });
      const up = () => {
        if (action === 'jump') this.input.ascend = false;
        if (action === 'crouch') this.input.descend = false;
        if (action === 'fire' || action === 'interact' || action === 'brake') (this.input[action] as boolean) = false;
      };
      button.addEventListener('pointerup', up); button.addEventListener('pointercancel', up);
    });
    root.querySelectorAll<HTMLButtonElement>('[data-equip]').forEach(button => {
      button.addEventListener('pointerdown', e => {
        e.preventDefault();
        this.input.equip = Number(button.dataset.equip);
      });
    });
  }
}
