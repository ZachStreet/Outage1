import { getStore } from '@netlify/blobs';
import { makeTrackHandler } from '../../lib/track.mjs';

export default makeTrackHandler(() => getStore({ name: 'outage-visitors', consistency: 'strong' }));
export const config = { path: '/api/track' };
