import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

// Only the game server loads these values. Vite receives no server credentials.
// Shell/container settings take precedence; tests select their backend explicitly.
if (existsSync('.env.server')) loadEnvFile('.env.server');
