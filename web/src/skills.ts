/* Bundle all skill markdowns via Vite's ?raw import */
import argueCreator from '../../skills/argue/creator.md?raw';
import argueDebater from '../../skills/argue/debater.md?raw';
import argueHeartbeat from '../../skills/argue/heartbeat.md?raw';
import argueReviewer from '../../skills/argue/reviewer.md?raw';
import courtLitigant from '../../skills/court/litigant.md?raw';
import mergeproofHunter from '../../skills/mergeproof/hunter.md?raw';
import mollyEarner from '../../skills/molly/earner.md?raw';
import mollyMoltbook from '../../skills/molly/moltbook.md?raw';

export const SKILLS: Record<string, string> = {
  'argue/creator': argueCreator,
  'argue/debater': argueDebater,
  'argue/heartbeat': argueHeartbeat,
  'argue/reviewer': argueReviewer,
  'court/litigant': courtLitigant,
  'mergeproof/hunter': mergeproofHunter,
  'molly/earner': mollyEarner,
  'molly/moltbook': mollyMoltbook,
};
