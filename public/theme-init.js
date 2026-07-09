(function () {
  var theme = localStorage.getItem('theme');
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  }

  try {
    var ui = JSON.parse(localStorage.getItem('ui-storage') || '{}');
    var lowData = ui.state && ui.state.lowDataMode === true;
    document.documentElement.classList.add(lowData ? 'font-low-data' : 'font-full');
  } catch {
    document.documentElement.classList.add('font-full');
  }
})();
