/**
 * Peer verification of questions (one rule, one place).
 *
 * Before this, `PUT /messages/:id/status` let the question's AUTHOR set
 * VERIFIED. Inside a study group that is a harmless convention; on a question
 * bank sold to a stranger it is a quality claim the data cannot support, and
 * quality is the only thing that makes the corpus defensible.
 *
 * The rule: a question may become VERIFIED only once at least
 * `VERIFY_PEER_UPVOTES` DISTINCT users who are NOT its author have upvoted it.
 * Who *asks* for the change is irrelevant — author and group admin alike are
 * refused below the threshold — so there is nothing for a client to bypass and
 * the server is the only place the rule is enforced. Admins keep full freedom
 * over PENDING and REJECTED: removing a bad question needs no quorum.
 *
 * Self-attribution is excluded here for the same reason the north-star metric
 * excludes it (services/learningConnections.ts skips actorId === beneficiaryId):
 * a signal you can mint about yourself measures nothing.
 *
 * Rows ALREADY marked VERIFIED keep that status. This gates the transition into
 * VERIFIED, never the reading of it, so no backfill and no migration are needed;
 * every verification granted from here on is peer-backed.
 */

/** Distinct non-author upvotes a question needs before it can be VERIFIED. */
export const VERIFY_PEER_UPVOTES = 2;

/** A row from `question_votes` (PRIMARY KEY (message_id, user_id)). */
export interface QuestionVoteRecord {
    user_id?: string | null;
    userId?: string | null;
    vote_type?: string | null;
    voteType?: string | null;
}

const voterId = (vote: QuestionVoteRecord): string | null => {
    const id = vote?.user_id ?? vote?.userId;
    return typeof id === 'string' && id.length > 0 ? id : null;
};

const isUpvote = (vote: QuestionVoteRecord): boolean =>
    String(vote?.vote_type ?? vote?.voteType ?? '').toLowerCase() === 'up';

/**
 * Distinct upvoters other than the author. The table's primary key already makes
 * one row per (message, user), but the Set also absorbs a duplicated read and a
 * caller that concatenated two pages.
 */
export function countPeerUpvotes(
    votes: readonly QuestionVoteRecord[] | null | undefined,
    authorId: string | null | undefined
): number {
    if (!votes || votes.length === 0) return 0;
    const peers = new Set<string>();
    for (const vote of votes) {
        if (!isUpvote(vote)) continue;
        const id = voterId(vote);
        if (!id || id === authorId) continue;
        peers.add(id);
    }
    return peers.size;
}

/** The whole rule. `peerUpvotes` must already exclude the author. */
export function canVerifyQuestion(peerUpvotes: number): boolean {
    return Number.isFinite(peerUpvotes) && peerUpvotes >= VERIFY_PEER_UPVOTES;
}

/** Peer votes still missing before VERIFIED is reachable (0 once it is). */
export function peerUpvotesRemaining(peerUpvotes: number): number {
    const have = Number.isFinite(peerUpvotes) ? Math.max(0, Math.floor(peerUpvotes)) : 0;
    return Math.max(0, VERIFY_PEER_UPVOTES - have);
}

/**
 * The ONE copy for both clients and the server refusal. Web and mobile must show
 * the same sentence, so neither may spell these out locally.
 */
export const QUESTION_VERIFY_COPY = {
    /** Card progress, e.g. "1 of 2 peer votes". */
    progress: (peerUpvotes: number): string =>
        `${Math.min(
            VERIFY_PEER_UPVOTES,
            Number.isFinite(peerUpvotes) ? Math.max(0, Math.floor(peerUpvotes)) : 0
        )} of ${VERIFY_PEER_UPVOTES} peer votes`,
    /** Why the Verify control is unavailable — also the 409 body. */
    blocked: (peerUpvotes: number): string =>
        `Verified needs ${VERIFY_PEER_UPVOTES} upvotes from members other than the author. This question has ${
            Number.isFinite(peerUpvotes) ? Math.max(0, Math.floor(peerUpvotes)) : 0
        }.`,
    /**
     * Shown once the threshold is met. Deliberately not "Verified": the votes
     * are in, the status may not have been written yet.
     */
    ready: 'Enough peer votes to verify.',
} as const;
