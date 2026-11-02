// GET  /api/scores  -> every player's best run on each outage
// POST /api/scores  -> { key, name, puzzle, time, commands, escalations, tests } records a run
//                      { key, name } alone changes the player's display name
import { getStore } from '@netlify/blobs';
import { makeHandler } from '../../lib/board.mjs';

export default makeHandler(() => getStore({ name: 'outage-leaderboard', consistency: 'strong' }));

export const config = { path: '/api/scores' };
