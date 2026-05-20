import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'http://127.0.0.1:54321';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testAuthAndAPI() {
  try {
    console.log('1. Signing in...');
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: 'test@example.com',
      password: 'test123'
    });

    if (signInError) {
      console.error('Sign in error:', signInError);
      return;
    }

    console.log('Sign in successful!');
    const session = signInData.session;
    if (!session) {
      console.error('No session returned');
      return;
    }

    console.log('2. Testing API call with auth token...');
    const response = await fetch('http://localhost:3001/api/v1/groups', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('API Response status:', response.status);
    const responseData = await response.json();
    console.log('API Response data:', responseData);

    if (response.ok) {
      console.log('✅ API call successful! Authentication is working.');
    } else {
      console.log('❌ API call failed. Authentication might not be working.');
    }

  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

testAuthAndAPI();