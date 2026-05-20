import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'http://127.0.0.1:54321';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testCreateGroup() {
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

    console.log('2. Creating a test group...');
    const groupData = {
      name: 'Test Study Group',
      description: 'A test group for API testing',
      permissions: { allowPublicQuestions: true },
      invite_id: 'test123'
    };

    const createResponse = await fetch('http://localhost:3001/api/v1/groups', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(groupData)
    });

    console.log('Create group response status:', createResponse.status);
    const createResponseData = await createResponse.json();
    console.log('Create group response:', createResponseData);

    if (createResponse.ok) {
      console.log('✅ Group creation successful!');

      // Now test fetching groups
      console.log('3. Fetching groups...');
      const fetchResponse = await fetch('http://localhost:3001/api/v1/groups', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('Fetch groups response status:', fetchResponse.status);
      const fetchResponseData = await fetchResponse.json();
      console.log('Fetch groups response:', JSON.stringify(fetchResponseData, null, 2));
    } else {
      console.log('❌ Group creation failed.');
    }

  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

testCreateGroup();