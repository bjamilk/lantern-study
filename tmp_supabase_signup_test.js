(async () => {
  try {
    const fetchFn = typeof fetch !== 'undefined' ? fetch : (await import('node-fetch')).default;

    const res = await fetchFn('http://localhost:54321/auth/v1/signup', {
      method: 'POST',
      headers: {
        apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'test@example.com', password: 'pass123' }),
    });

    console.log('status', res.status);
    console.log(await res.text());
  } catch (err) {
    console.error('error', err);
  }
})();
