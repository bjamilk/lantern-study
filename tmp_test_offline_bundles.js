(async () => {
  try {
    const res = await fetch('http://127.0.0.1:3001/api/v1/offline-bundles?userId=test');
    console.log('status', res.status);
    const text = await res.text();
    console.log(text);
  } catch (err) {
    console.error('error', err);
  }
})();
