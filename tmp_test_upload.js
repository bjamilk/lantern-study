(async () => {
  try {
    const res = await fetch('http://localhost:3001/api/v1/flashcards/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'test.png', base64Data: 'ZmFrZQ==', contentType: 'image/png' }),
    });
    console.log('status', res.status);
    console.log(await res.text());
  } catch (err) {
    console.error('error', err);
    process.exit(1);
  }
})();
