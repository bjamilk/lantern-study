const API_KEY = process.env.LANTERN_TEST_API_KEY;

async function testAPI() {
  if (!API_KEY) {
    console.error('Set LANTERN_TEST_API_KEY to a valid API key or JWT before running this script.');
    process.exit(1);
  }

  try {
    const response = await fetch('http://localhost:3001/api/v1/groups?userId=test-user-123', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));

    if (response.ok) {
      const data = await response.json();
      console.log('Success:', data);
    } else {
      const error = await response.text();
      console.log('Error:', error);
    }
  } catch (error) {
    console.error('Network error:', error);
  }
}

testAPI();
