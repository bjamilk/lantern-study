import { getDashboardFirstName } from './displayNames';

describe('getDashboardFirstName', () => {
  it('prefers firstName over display name', () => {
    expect(
      getDashboardFirstName({
        firstName: 'Jane',
        name: 'Jane Doe',
        username: 'janedoe',
      })
    ).toBe('Jane');
  });

  it('uses first word of full name when firstName is missing', () => {
    expect(
      getDashboardFirstName({
        name: 'Alex Smith',
        username: 'alexsmith',
      })
    ).toBe('Alex');
  });

  it('does not use username when name matches username', () => {
    expect(
      getDashboardFirstName({
        name: 'janedoe',
        username: 'janedoe',
      })
    ).toBe('Student');
  });

  it('supports snake_case first_name from API profiles', () => {
    expect(
      getDashboardFirstName({
        first_name: 'Mindi',
        name: 'Mindi Caron',
      })
    ).toBe('Mindi');
  });

  it('does not use long email-like local parts as a greeting name', () => {
    expect(
      getDashboardFirstName({
        name: 'responsive.audit.1784645242',
      })
    ).toBe('Student');
  });
});
