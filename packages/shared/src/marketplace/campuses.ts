export interface MarketplaceCampus {
  id: string;
  name: string;
  city: string;
  state: string;
  country_code: string;
  slug: string;
}

/** Seed campuses for Nigeria — synced with DB migration. */
export const NIGERIA_MARKETPLACE_CAMPUSES: Omit<MarketplaceCampus, 'id'>[] = [
  { name: 'University of Lagos', city: 'Lagos', state: 'Lagos', country_code: 'NG', slug: 'university-of-lagos' },
  { name: 'University of Nigeria, Nsukka', city: 'Nsukka', state: 'Enugu', country_code: 'NG', slug: 'university-of-nigeria-nsukka' },
  { name: 'Obafemi Awolowo University', city: 'Ile-Ife', state: 'Osun', country_code: 'NG', slug: 'obafemi-awolowo-university' },
  { name: 'University of Ibadan', city: 'Ibadan', state: 'Oyo', country_code: 'NG', slug: 'university-of-ibadan' },
  { name: 'Ahmadu Bello University', city: 'Zaria', state: 'Kaduna', country_code: 'NG', slug: 'ahmadu-bello-university' },
  { name: 'University of Benin', city: 'Benin City', state: 'Edo', country_code: 'NG', slug: 'university-of-benin' },
  { name: 'University of Port Harcourt', city: 'Port Harcourt', state: 'Rivers', country_code: 'NG', slug: 'university-of-port-harcourt' },
  { name: 'Covenant University', city: 'Ota', state: 'Ogun', country_code: 'NG', slug: 'covenant-university' },
  { name: 'Babcock University', city: 'Ilishan-Remo', state: 'Ogun', country_code: 'NG', slug: 'babcock-university' },
  { name: 'Lagos State University', city: 'Ojo', state: 'Lagos', country_code: 'NG', slug: 'lagos-state-university' },
  { name: 'Federal University of Technology, Akure', city: 'Akure', state: 'Ondo', country_code: 'NG', slug: 'futa-akure' },
  { name: 'Nnamdi Azikiwe University', city: 'Awka', state: 'Anambra', country_code: 'NG', slug: 'nnamdi-azikiwe-university' },
  { name: 'University of Jos', city: 'Jos', state: 'Plateau', country_code: 'NG', slug: 'university-of-jos' },
  { name: 'Bayero University Kano', city: 'Kano', state: 'Kano', country_code: 'NG', slug: 'bayero-university-kano' },
  { name: 'University of Calabar', city: 'Calabar', state: 'Cross River', country_code: 'NG', slug: 'university-of-calabar' },
  { name: 'Federal University of Technology, Minna', city: 'Minna', state: 'Niger', country_code: 'NG', slug: 'fut-minna' },
  { name: 'University of Maiduguri', city: 'Maiduguri', state: 'Borno', country_code: 'NG', slug: 'university-of-maiduguri' },
  { name: 'Lagos University Teaching Hospital', city: 'Lagos', state: 'Lagos', country_code: 'NG', slug: 'luth-lagos' },
  { name: 'Yaba College of Technology', city: 'Yaba', state: 'Lagos', country_code: 'NG', slug: 'yaba-college-of-technology' },
  { name: 'Pan-Atlantic University', city: 'Lekki', state: 'Lagos', country_code: 'NG', slug: 'pan-atlantic-university' },
];

export function formatCampusLabel(campus: Pick<MarketplaceCampus, 'name' | 'city'>): string {
  return campus.city ? `${campus.name} (${campus.city})` : campus.name;
}
