import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Simulation } from '../shared/simulation';
import { packState } from '../shared/protocol';
const results = [];
for (const operators of [12, 18, 24]) {
  const sim = new Simulation(operators, 451);
  const timings: number[] = [];
  const packets: number[] = [];
  let event = -1;
  for (let tick = 0; tick < 3600; tick++) {
    const start = performance.now(); sim.tick(1 / 30); timings.push(performance.now() - start);
    if (tick % 2 === 0) { packets.push(Buffer.byteLength(JSON.stringify(packState(sim.state, event)))); event = sim.state.events.at(-1)?.id ?? event; }
  }
  timings.sort((a, b) => a - b);
  const avgBytes = packets.reduce((a, b) => a + b, 0) / packets.length;
  results.push({ operators, simulatedSeconds: 120, tickP50Ms: +timings[Math.floor(timings.length * 0.5)].toFixed(3), tickP95Ms: +timings[Math.floor(timings.length * 0.95)].toFixed(3), tickP99Ms: +timings[Math.floor(timings.length * 0.99)].toFixed(3), meanSnapshotBytes: Math.round(avgBytes), estimatedKiBPerSecondPerClient: +(avgBytes * 15 / 1024).toFixed(1), scores: sim.state.scores, kills: Object.values(sim.state.players).reduce((sum, p) => sum + p.kills, 0) });
}
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/simulation-benchmark.json', JSON.stringify({ note: 'Single local Node process; CPU simulation only. Includes bots and JSON full snapshots with event deltas. Excludes render, network latency, TLS and concurrent rooms.', results }, null, 2));
console.table(results);
