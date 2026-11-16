// main.ts — Cinderfall's submission program (Node 22, standard library only).
//
// The game lives in game/ next to this file: plain static ES-module files the browser
// loads with no build step, three.js 0.187.0 vendored inside it. All this program does
// is hand that game to the grader: copy game/ and screenshots/ into the output
// directory and write dossier.json there, built by the kit's own library
// (vendor/makefun-threejs.ts, shipped unchanged), so the dossier the judge reads is
// exactly the one the library builds from these files.
//
// Run it locally with the output directory overridden:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// In the grader's container MAKEFUN_OUTPUT_DIR is unset and /output is the target.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's own caps, mirrored here so this program refuses what the gate
// would refuse instead of handing in an entry it cannot accept: at most 4
// screenshots of 256 KiB each, at most 993 files / 48 MiB under game/, and the
// dossier's source text capped at 160 KiB.
const DOSSIER_LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

function handIn() {
  mkdirSync(outputDir, { recursive: true });
  cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });
  mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
  if (existsSync(join(repoRoot, 'screenshots'))) {
    cpSync(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });
  }
  writeFileSync(
    join(outputDir, 'dossier.json'),
    buildDossier(outputDir, DOSSIER_LIMITS),
  );
}

handIn();
