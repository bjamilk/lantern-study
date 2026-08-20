/**
 * Mass-assignment guard on marketplace listing writes.
 *
 * category_specific_fields is written verbatim from the client and is where
 * boost state lives (boosted_until / boost_level), read as `is_boosted` by the
 * search RPC — so an unstripped write is a free, indefinite, top-of-search
 * boost. quantity/listing_kind/bundle_items were also unvalidated on update.
 */
import { SupabaseService } from './supabase';

function makeInsertCapture() {
  const inserts: Array<Record<string, any>> = [];
  const api: any = {};
  api.insert = (payload: Record<string, any>) => {
    inserts.push(payload);
    return api;
  };
  api.select = () => api;
  api.single = async () => ({ data: { id: 'l1', ...inserts[inserts.length - 1] }, error: null });
  return { db: { from: () => api }, inserts };
}

function makeUpdateCapture() {
  const updates: Array<Record<string, any>> = [];
  const api: any = {};
  api.update = (payload: Record<string, any>) => {
    updates.push(payload);
    return api;
  };
  api.eq = () => api;
  api.select = () => api;
  api.single = async () => ({ data: { id: 'l1' }, error: null });
  return { db: { from: () => api }, updates };
}

const createCall = (self: unknown, data: Record<string, unknown>) =>
  SupabaseService.prototype.createMarketplaceListing.call(self as any, data, 'user-1');

const updateCall = (self: unknown, updates: Record<string, unknown>) =>
  SupabaseService.prototype.updateMarketplaceListing.call(self as any, 'l1', updates);

describe('createMarketplaceListing mass-assignment guard', () => {
  it('strips client-supplied boost keys from category_specific_fields', async () => {
    const { db, inserts } = makeInsertCapture();
    await createCall(
      { supabase: db },
      {
        category: 'textbooks',
        title: 'Anatomy notes',
        campus_id: 'campus-1',
        category_specific_fields: {
          boosted_until: '2099-01-01T00:00:00Z',
          boost_level: 'premium',
          condition: 'used',
        },
      },
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0].category_specific_fields).toEqual({ condition: 'used' });
    expect(inserts[0].category_specific_fields.boosted_until).toBeUndefined();
    expect(inserts[0].category_specific_fields.boost_level).toBeUndefined();
  });

  it('rejects an unknown listing_kind', async () => {
    const { db } = makeInsertCapture();
    await expect(
      createCall(
        { supabase: db },
        { category: 'x', title: 't', campus_id: 'campus-1', listing_kind: 'evil' },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('updateMarketplaceListing mass-assignment guard', () => {
  const selfWithListing = (updateDb: ReturnType<typeof makeUpdateCapture>['db']) => ({
    supabase: updateDb,
    // Existing listing already carries a legitimately-granted boost.
    getMarketplaceListingById: jest.fn(async () => ({
      id: 'l1',
      category_specific_fields: {
        boosted_until: '2099-01-01T00:00:00Z',
        boost_level: 'standard',
        size: 'L',
      },
    })),
  });

  it('strips injected boost keys while preserving the existing server boost', async () => {
    const { db, updates } = makeUpdateCapture();
    await updateCall(selfWithListing(db), {
      category_specific_fields: {
        boosted_until: 'HACK-FOREVER',
        boost_level: 'premium',
        size: 'M',
      },
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].category_specific_fields).toEqual({
      size: 'M',
      boosted_until: '2099-01-01T00:00:00Z',
      boost_level: 'standard',
    });
  });

  it('validates quantity on update (rejects negative and non-integer)', async () => {
    const { db } = makeUpdateCapture();
    await expect(updateCall(selfWithListing(db), { quantity: -3 })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(updateCall(selfWithListing(db), { quantity: 2.5 })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('accepts a valid quantity on update', async () => {
    const { db, updates } = makeUpdateCapture();
    await updateCall(selfWithListing(db), { quantity: 5 });
    expect(updates[updates.length - 1].quantity).toBe(5);
  });

  it('treats listing_kind as immutable (never written on update)', async () => {
    const { db, updates } = makeUpdateCapture();
    await updateCall(selfWithListing(db), { title: 'renamed', listing_kind: 'question_bank' });
    expect(updates[updates.length - 1].listing_kind).toBeUndefined();
    expect(updates[updates.length - 1].title).toBe('renamed');
  });
});
