import {
  formatMarketplaceAddressLine,
  validateMarketplaceAddress,
  type MarketplaceAddressDraft,
} from '@lantern/shared/marketplace';
import { PublicError } from '../utils/safeError';
import type { SupabaseService } from './supabase';

const addressSelect =
  'id, user_id, label, recipient_name, phone, campus_id, city, line1, line2, landmark, hall, is_default, created_at, updated_at';

export class MarketplaceAddressesService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
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
      await this.db.from('marketplace_addresses').update({ is_default: false }).eq('user_id', userId);
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
      await this.db.from('marketplace_addresses').update({ is_default: false }).eq('user_id', userId);
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
        await this.db
          .from('marketplace_addresses')
          .update({ is_default: true })
          .eq('id', rest[0].id);
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
  supabaseService: SupabaseService,
): MarketplaceAddressesService {
  if (!addressesService) addressesService = new MarketplaceAddressesService(supabaseService);
  return addressesService;
}
