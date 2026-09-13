/**
 * What the Communities segment asks for. The plan itself is shared so web
 * and mobile send the same `GET /discover/communities` parameters.
 */
export {
  COMMUNITY_DISCOVER_LIMIT,
  chipServerKind,
  planCommunityDiscovery,
  type CommunityDiscoveryPlan,
  type DiscoverParams,
} from '@lantern/shared/network';
