import {
  BOTTOM_TABS,
  TAB_KEY_BY_ROUTE,
  TAB_LABELS,
  TAB_ROUTE_BY_KEY,
  isBottomTab,
  resolveActiveTab,
  tabTitle,
  type TabKey,
} from './tabRouting';

describe('the five destinations', () => {
  it('are Home · Study · Chat · Campus · Me, in that order', () => {
    expect(BOTTOM_TABS).toEqual(['Home', 'Study', 'Chat', 'Campus', 'Me']);
  });

  it('opens on Home, so the launch tab is the first column', () => {
    expect(BOTTOM_TABS[0]).toBe('Home');
  });

  it('keeps Notifications and Lantern AI OUT of the bar (they follow you)', () => {
    expect(isBottomTab('Notifications')).toBe(false);
    expect(isBottomTab('AI')).toBe(false);
    for (const tab of BOTTOM_TABS) expect(isBottomTab(tab)).toBe(true);
  });

  it('gives every destination exactly one name', () => {
    expect(TAB_LABELS.Campus).toBe('Campus');
    expect(TAB_LABELS.Me).toBe('Me');
    // "AI credits" is one string elsewhere; the surface itself is Lantern AI.
    expect(TAB_LABELS.AI).toBe('Lantern AI');
    const printed = BOTTOM_TABS.map((tab) => TAB_LABELS[tab]);
    expect(new Set(printed).size).toBe(printed.length);
  });

  it('routes every bottom tab to a real tab route', () => {
    for (const tab of BOTTOM_TABS) {
      const route = TAB_ROUTE_BY_KEY[tab];
      expect(route).toBeTruthy();
      expect(TAB_KEY_BY_ROUTE[route as string]).toBe(tab);
    }
  });

  it('gives Lantern AI no route at all — it is a panel, not a place', () => {
    expect(TAB_ROUTE_BY_KEY.AI).toBeNull();
  });
});

describe('resolveActiveTab', () => {
  const on = (tabRouteName: string | undefined, companionOpen = false): TabKey =>
    resolveActiveTab({ tabRouteName, companionOpen });

  it('lights the tab whose stack is focused', () => {
    expect(on('HomeTab')).toBe('Home');
    expect(on('StudyTab')).toBe('Study');
    expect(on('ChatTab')).toBe('Chat');
    expect(on('CampusTab')).toBe('Campus');
    expect(on('MeTab')).toBe('Me');
  });

  it('lights Campus while a retired Shop or Jobs route is being redirected', () => {
    expect(on('MarketTab')).toBe('Campus');
    expect(on('JobsTab')).toBe('Campus');
  });

  it('lights Me while the retired Budget route is being redirected', () => {
    expect(on('BudgetTab')).toBe('Me');
  });

  it('lights no bottom tab for Notifications — it is a top-bar surface', () => {
    expect(isBottomTab(on('NotificationsTab'))).toBe(false);
    expect(on('NotificationsTab')).toBe('Notifications');
  });

  it('lights Lantern AI whenever the companion panel is open, over any tab', () => {
    expect(on('ChatTab', true)).toBe('AI');
    expect(on('CampusTab', true)).toBe('AI');
    expect(on(undefined, true)).toBe('AI');
  });

  it('falls back to Home, not to whichever key an object lists first', () => {
    expect(on(undefined)).toBe('Home');
    expect(on('SomeRouteThatNoLongerExists')).toBe('Home');
  });
});

describe('tabTitle', () => {
  it('titles the top bar with the destination the reader is in', () => {
    expect(tabTitle('Campus')).toBe('Campus');
    expect(tabTitle('Me')).toBe('Me');
    expect(tabTitle('Notifications')).toBe('Notifications');
  });
});
