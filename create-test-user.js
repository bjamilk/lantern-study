import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'http://127.0.0.1:54321';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const supabase = createClient(supabaseUrl, supabaseKey);

async function createTestUser() {
  try {
    const { data, error } = await supabase.auth.signUp({
      email: 'test@example.com',
      password: 'test123'
    });

    if (error) {
      console.error('Error creating user:', error);
      return;
    }

    console.log('User created:', data);

    if (data.user) {
      // Create profile
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: data.user.id,
          name: 'Test User',
          points: 0,
          stats: {},
          settings: {},
          badges: []
        });

      if (profileError) {
        console.error('Error creating profile:', profileError);
      } else {
        console.log('Profile created successfully');
      }
    }
  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

createTestUser();