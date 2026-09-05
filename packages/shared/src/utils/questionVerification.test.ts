import {
    canVerifyQuestion,
    countPeerUpvotes,
    peerUpvotesRemaining,
    QUESTION_VERIFY_COPY,
    VERIFY_PEER_UPVOTES,
} from './questionVerification';

const AUTHOR = 'author-1';

describe('countPeerUpvotes', () => {
    it('ignores the author’s own upvote — a self-minted signal measures nothing', () => {
        expect(
            countPeerUpvotes(
                [
                    { user_id: AUTHOR, vote_type: 'up' },
                    { user_id: 'peer-1', vote_type: 'up' },
                ],
                AUTHOR
            )
        ).toBe(1);
    });

    it('counts only upvotes, never downvotes', () => {
        expect(
            countPeerUpvotes(
                [
                    { user_id: 'peer-1', vote_type: 'up' },
                    { user_id: 'peer-2', vote_type: 'down' },
                ],
                AUTHOR
            )
        ).toBe(1);
    });

    it('counts each peer once even if the rows are duplicated', () => {
        expect(
            countPeerUpvotes(
                [
                    { user_id: 'peer-1', vote_type: 'up' },
                    { user_id: 'peer-1', vote_type: 'up' },
                ],
                AUTHOR
            )
        ).toBe(1);
    });

    it('accepts camelCase rows and tolerates empty / missing input', () => {
        expect(countPeerUpvotes([{ userId: 'peer-1', voteType: 'up' }], AUTHOR)).toBe(1);
        expect(countPeerUpvotes([], AUTHOR)).toBe(0);
        expect(countPeerUpvotes(undefined, AUTHOR)).toBe(0);
        expect(countPeerUpvotes([{ user_id: null, vote_type: 'up' }], AUTHOR)).toBe(0);
    });

    it('counts every upvoter when the author is unknown', () => {
        expect(
            countPeerUpvotes(
                [
                    { user_id: 'peer-1', vote_type: 'up' },
                    { user_id: 'peer-2', vote_type: 'up' },
                ],
                null
            )
        ).toBe(2);
    });
});

describe('canVerifyQuestion', () => {
    it('refuses below the threshold and allows at or above it', () => {
        expect(canVerifyQuestion(0)).toBe(false);
        expect(canVerifyQuestion(VERIFY_PEER_UPVOTES - 1)).toBe(false);
        expect(canVerifyQuestion(VERIFY_PEER_UPVOTES)).toBe(true);
        expect(canVerifyQuestion(VERIFY_PEER_UPVOTES + 5)).toBe(true);
    });

    it('treats a non-number as no votes rather than as permission', () => {
        expect(canVerifyQuestion(Number.NaN)).toBe(false);
        expect(canVerifyQuestion(undefined as unknown as number)).toBe(false);
    });

    it('is not satisfied by the author upvoting their own question', () => {
        const votes = [
            { user_id: AUTHOR, vote_type: 'up' },
            { user_id: AUTHOR, vote_type: 'up' },
        ];
        expect(canVerifyQuestion(countPeerUpvotes(votes, AUTHOR))).toBe(false);
    });

    it('is satisfied by two distinct peers', () => {
        const votes = [
            { user_id: AUTHOR, vote_type: 'up' },
            { user_id: 'peer-1', vote_type: 'up' },
            { user_id: 'peer-2', vote_type: 'up' },
        ];
        expect(canVerifyQuestion(countPeerUpvotes(votes, AUTHOR))).toBe(true);
    });
});

describe('peerUpvotesRemaining', () => {
    it('counts down and never goes negative', () => {
        expect(peerUpvotesRemaining(0)).toBe(VERIFY_PEER_UPVOTES);
        expect(peerUpvotesRemaining(1)).toBe(VERIFY_PEER_UPVOTES - 1);
        expect(peerUpvotesRemaining(VERIFY_PEER_UPVOTES)).toBe(0);
        expect(peerUpvotesRemaining(99)).toBe(0);
    });
});

describe('QUESTION_VERIFY_COPY', () => {
    it('reads "1 of 2 peer votes" and clamps at the threshold', () => {
        expect(QUESTION_VERIFY_COPY.progress(1)).toBe('1 of 2 peer votes');
        expect(QUESTION_VERIFY_COPY.progress(0)).toBe('0 of 2 peer votes');
        expect(QUESTION_VERIFY_COPY.progress(7)).toBe('2 of 2 peer votes');
        expect(QUESTION_VERIFY_COPY.progress(-3)).toBe('0 of 2 peer votes');
    });

    it('says why a verify is refused, with the count the caller can act on', () => {
        expect(QUESTION_VERIFY_COPY.blocked(1)).toContain('other than the author');
        expect(QUESTION_VERIFY_COPY.blocked(1)).toContain('has 1');
        expect(QUESTION_VERIFY_COPY.blocked(0)).toContain('has 0');
    });
});
