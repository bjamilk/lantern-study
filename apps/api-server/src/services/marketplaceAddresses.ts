import {
  formatMarketplaceAddressLine,
  validateMarketplaceAddress,
  type MarketplaceAddressDraft,
} from '@lantern/shared/marketplace';
import { PublicError } from '../utils/safeError';
import { bestEffortWrite, mustWrite } from './data/writeResult';
import type { DataLayer } from './data';

const addressSelect =
  'id, user_id, label, recipient_name, phone, campus_id, city, line1, line2, landmark, hall, is_default, created_at, updated_at';

export class MarketplaceAddressesService {
  constructor(private readonly data: DataLayer) {}

  private get db() {
    return this.data.getClient();
  }

  async list(userId: string) {
    const { data, error } = await this.db
      .from('marketplace_addresses')
      .select(addressSelect)
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async getOwned(userId: string, addressId: string) {
    const { data, error } = await this.db
      .from('marketplace_addresses')
      .select(addressSelect)
      .eq('id', addressId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(userId: string, input: Partial<MarketplaceAddressDraft>) {
    const parsed = validateMarketplaceAddress(input);
    if (!parsed.ok) throw new PublicError(parsed.error);
    const existing = await this.list(userId);
    const isDefault = existing.length === 0 || Boolean(parsed.value.is_default);
    if (isDefault) {
      // MUST SUCCEED (#108), and the ORDER is the safety: clearing runs before
      // the new row exists, so a failure here leaves the user exactly one
      // default — the old one — instead of two. Carrying on would insert a
      // second `is_default` row, and the clients pick the default with
      // `rows.find((row) => row.is_default)`, which is then whichever row the
      // list returns first: a buyer can be shipped to an address they did not
      // choose. Nothing external has happened, so stopping costs the request.
      mustWrite(
        await this.db.from('marketplace_addresses').update({ is_default: false }).eq('user_id', userId),
        { table: 'marketplace_addresses', op: 'update', userId, reason: 'clear_previous_default' },
      );
    }
    const { data, error } = await this.db
      .from('marketplace_addresses')
      .insert({
        user_id: userId,
        ...parsed.value,
        is_default: isDefault,
        updated_at: new Date().toISOString(),
      })
      .select(addressSelect)
      .single();
    if (error) throw error;
    return data;
  }

  async update(userId: string, addressId: string, input: Partial<MarketplaceAddressDraft>) {
    const current = await this.getOwned(userId, addressId);
    if (!current) throw new PublicError('Address not found');
    const parsed = validateMarketplaceAddress({ ...current, ...input });
    if (!parsed.ok) throw new PublicError(parsed.error);
    if (parsed.value.is_default) {
      // MUST SUCCEED (#108): same two-write flip, same ordering, same reason —
      // the clear runs before this row is marked default, so a failure leaves
      // one default rather than two.
      mustWrite(
        await this.db.from('marketplace_addresses').update({ is_default: false }).eq('user_id', userId),
        {
          table: 'marketplace_addresses',
          op: 'update',
          userId,
          addressId,
          reason: 'clear_previous_default',
        },
      );
    }
    const { data, error } = await this.db
      .from('marketplace_addresses')
      .update({
        ...parsed.value,
        updated_at: new Date().toISOString(),
      })
      .eq('id', addressId)
      .eq('user_id', userId)
      .select(addressSelect)
      .single();
    if (error) throw error;
    return data;
  }

  async remove(userId: string, addressId: string) {
    const current = await this.getOwned(userId, addressId);
    if (!current) throw new PublicError('Address not found');
    const { error } = await this.db
      .from('marketplace_addresses')
      .delete()
      .eq('id', addressId)
      .eq('user_id', userId);
    if (error) throw error;
    if (current.is_default) {
      const rest = await this.list(userId);
      if (rest[0]) {
        // BEST EFFORT at ERROR level (#108). The mirror image of the flip
        // above, and the opposite class: this runs AFTER a delete that cannot
        // be undone, so throwing would report failure for a removal that
        // happened and a retry would 404. A failure leaves ZERO defaults, which
        // is the safe direction — the clients fall back to `rows[0]` and the
        // user can set one again — but it is still a state nobody asked for.
        bestEffortWrite(
          await this.db
            .from('marketplace_addresses')
            .update({ is_default: true })
            .eq('id', rest[0].id),
          {
            table: 'marketplace_addresses',
            op: 'update',
            userId,
            addressId: rest[0].id,
            reason: 'promote_default_after_delete',
          },
          'error',
        );
      }
    }
    return { removed: true };
  }

  snapshot(address: Record<string, unknown>) {
    return {
      id: address.id,
      recipient_name: address.recipient_name,
      phone: address.phone,
      campus_id: address.campus_id,
      city: address.city,
      line1: address.line1,
      line2: address.line2,
      landmark: address.landmark,
      hall: address.hall,
      formatted: formatMarketplaceAddressLine({
        line1: String(address.line1 || ''),
        line2: address.line2 as string | null,
        hall: address.hall as string | null,
        city: String(address.city || ''),
        landmark: address.landmark as string | null,
      }),
    };
  }
}

let addressesService: MarketplaceAddressesService | null = null;

export function getMarketplaceAddressesService(
  data: DataLayer,
): MarketplaceAddressesService {
  if (!addressesService) addressesService = new MarketplaceAddressesService(data);
  return addressesService;
}
