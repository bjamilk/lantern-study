(async () => {
  try {
    const res = await fetch('http://localhost:5174/components/CreateFlashcardModal.tsx');
    console.log('status', res.status);
    const txt = await res.text();
    console.log('body', txt.slice(0, 2000));
  } catch (err) {
    console.error('fetch error', err);
  }
})();
