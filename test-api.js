const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0LXVzZXItMTIzIiwicGVybWlzc2lvbnMiOlsicmVhZCIsIndyaXRlIl0sImlhdCI6MTc2MzU2MDIyNSwiZXhwIjoxNzYzNjQ2NjI1fQ._va9wuqWZS8pJHD-vXlqcavFI5E3uLl0GD8UX4dJyYU';

async function testAPI() {
  try {
    const response = await fetch('http://localhost:3001/api/v1/groups?userId=test-user-123', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
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