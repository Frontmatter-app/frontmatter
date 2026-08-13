/**
 * Team name resolution moved to the data layer, where it goes through the
 * teams port instead of talking to Firestore directly. Re-exported here so
 * existing imports keep working.
 */
export { useTeamNames } from '../data/hooks';
export type { TeamItem } from '../data/hooks';
