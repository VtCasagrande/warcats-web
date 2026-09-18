# 004 — Transporte e apoio tático
Execução da evolução solicitada pelo usuário, seguindo planos modulares e revisão de animação da skill improve-animations já invocada. O projeto ganhou slots, classes, attachments e XP desde a revisão anterior: preservar esses sistemas.

Root: shared/types, vehicles, simulation, physics/protocol/bots, testes e Magnific.
Executor motion: src/game/renderer.ts, controls.ts, models.ts e novos vehicle-models.ts/skins.ts; câmera/interpolação/rodas/rotor e armas/skins. Sem editar shared.
Executor UI: src/ui/*, style.css. Menu, skins, HUD de veículos e apoio; sem editar main/shared.
Executor mapa/áudio: shared/maps.ts, src/game/environment.ts e audio.ts, testes de prédios. Sem editar shared/types/simulation/renderer/main.

Contratos root: VehicleKind jeep|helicopter; Vehicle {id,kind,team,x,y,z,yaw,pitch,roll,vx,vy,vz,speed,health,maxHealth,fuel,seats:(string|null)[],respawnAt,rotor,spawn:{x,z},distance}. Match.vehicles Vehicle[], Match.spots {id,target,team,by,x,y,z,expiresAt}[]; Player.vehicleId:string|null,vehicleSeat:number,suppression:number,supportPoints:number,transports:number,skin:SkinId. SkinId standard|woodland|desert|arctic|urban|carbon|ember|naval. Input.vehicle:boolean(E),ascend:boolean(Spacehold),descend:boolean(C/Ctrlhold). Events spot/suppression/transport/vehicle. Entrar veículo aliado próximo, E sair; motorista WASD; heli WASD voa horiz.,Space sobe/C desce. Câmera chasevehicle (sweep parede), mouseolhar independente, arma escondidaembarcado. Rotors/wheels useactualmotion;transform/opacityUI, reducedmotionsemshake/bob; microtransições160-220ms cubic-bezier(.23,1,.32,1).

Jeep4assentos,heli6,semarmamentomontadonestaentrega. Entrega75m+ desembarquepróximozonea menosde40kmh/heli pousado, recompensauma vez porpassageiro/vida; bots aliados embarcamaovistar motoristaperto da base. Q marca inimigo visível por4s; posiçõesnãoatravessamparedesatualização, créditoassistnaeliminação. Supressãoportrajetóriapróxima semparedes, cooldownXP/cashsemfarming deprojétil.
