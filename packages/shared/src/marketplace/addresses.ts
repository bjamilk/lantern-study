export type MarketplaceAddressDraft = {
  label?: string | null;
  recipient_name: string;
  phone: string;
  campus_id?: string | null;
  city: string;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  hall?: string | null;
  is_default?: boolean;
};

const PHONE_MIN = 8;
const LINE_MAX = 200;
const NAME_MAX = 80;

function trim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateMarketplaceAddress(
  input: Partial<MarketplaceAddressDraft>,
): { ok: true; value: MarketplaceAddressDraft } | { ok: false; error: string } {
  const recipient_name = trim(input.recipient_name);
  const phone = trim(input.phone).replace(/\s+/g, '');
  const city = trim(input.city);
  const line1 = trim(input.line1);
  if (!recipient_name || recipient_name.length > NAME_MAX) {
    return { ok: false, error: 'Enter the recipient name' };
  }
  if (phone.length < PHONE_MIN) {
    return { ok: false, error: 'Enter a phone number the rider can call' };
  }
  if (!city || city.length > 80) {
    return { ok: false, error: 'Enter a city' };
  }
  if (!line1 || line1.length > LINE_MAX) {
    return { ok: false, error: 'Enter a street address or hall' };
  }
  return {
    ok: true,
    value: {
      label: trim(input.label) || null,
      recipient_name,
      phone,
      campus_id: trim(input.campus_id) || null,
      city,
      line1,
      line2: trim(input.line2) || null,
      landmark: trim(input.landmark) || null,
      hall: trim(input.hall) || null,
      is_default: Boolean(input.is_default),
    },
  };
}

export function formatMarketplaceAddressLine(
  address: Pick<MarketplaceAddressDraft, 'line1' | 'line2' | 'hall' | 'city' | 'landmark'>,
): string {
  return [address.hall, address.line1, address.line2, address.landmark, address.city]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(', ');
}
