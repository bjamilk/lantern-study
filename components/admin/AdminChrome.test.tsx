import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminKpi, AdminMetricRow, AdminPageHeader, AdminSectionTitle, AdminSegmented, AdminStatusBadge, AdminToolbar } from './AdminChrome';
import { AdminNav } from './AdminNav';
import { AdminUsers } from './AdminUsers';

describe('AdminChrome', () => {
  it('marks the selected segment and shows a queue badge', () => {
    const html = renderToStaticMarkup(
      <AdminSegmented
        ariaLabel="Marketplace views"
        value="orders"
        onChange={() => undefined}
        options={[
          { id: 'listings', label: 'Listings' },
          { id: 'orders', label: 'Orders & disputes', badge: 4 },
        ]}
      />,
    );
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('Orders &amp; disputes');
    expect(html).toContain('4');
  });

  it('renders a page header and a status badge', () => {
    const html = renderToStaticMarkup(
      <>
        <AdminPageHeader eyebrow="People" title="Users" description="Search accounts." />
        <AdminStatusBadge tone="danger">Banned</AdminStatusBadge>
      </>,
    );
    expect(html).toContain('Users');
    expect(html).toContain('Banned');
  });

  it('renders a section title and a metric row', () => {
    const html = renderToStaticMarkup(
      <>
        <AdminSectionTitle title="Marketplace (period)" description="Completed sales." />
        <AdminMetricRow label="GMV" value="₦12,000" />
      </>,
    );
    expect(html).toContain('Marketplace (period)');
    expect(html).toContain('Completed sales.');
    expect(html).toContain('GMV');
    expect(html).toContain('₦12,000');
  });

  it('renders compact KPIs and a toolbar', () => {
    const html = renderToStaticMarkup(
      <>
        <AdminKpi compact label="DAU" value={12} />
        <AdminToolbar actions={<span>Export</span>}>
          <span>Open queue</span>
        </AdminToolbar>
      </>,
    );
    expect(html).toContain('DAU');
    expect(html).toContain('12');
    expect(html).toContain('Open queue');
    expect(html).toContain('Export');
  });
});

describe('AdminNav', () => {
  it('labels strip items so sections are readable', () => {
    const html = renderToStaticMarkup(
      <AdminNav activeTab="reports" onSelect={() => undefined} variant="strip" badges={{ reports: 2 }} />,
    );
    expect(html).toContain('Reports');
    expect(html).not.toContain('sr-only');
    expect(html).toContain('2');
  });
});

describe('AdminUsers', () => {
  it('shows identity, status, and moderation actions', () => {
    const html = renderToStaticMarkup(
      <AdminUsers
        users={[
          {
            id: 'u1',
            name: 'Ada',
            email: 'ada@school.edu',
            created_at: '2026-01-01T00:00:00.000Z',
            is_banned: false,
            is_platform_admin: true,
          },
        ]}
        pagination={null}
        userSearch=""
        actionLoading={{}}
        onSearchChange={() => undefined}
        onPrev={() => undefined}
        onNext={() => undefined}
        onSelectUser={() => undefined}
        onToggleBan={() => undefined}
        onToggleAdmin={() => undefined}
      />,
    );
    expect(html).toContain('Ada');
    expect(html).toContain('ada@school.edu');
    expect(html).toContain('Active');
    expect(html).toContain('Admin');
    expect(html).toContain('Ban');
    expect(html).toContain('Revoke admin');
  });
});
