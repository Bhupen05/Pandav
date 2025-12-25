const API_URL = 'https://pandav.onrender.com/api';

async function testAPI() {
  try {
    // Test health check
    console.log('Testing health check...');
    const health = await fetch(`${API_URL}/health`);
    console.log('Health:', await health.json());

    // Test register
    console.log('\nTesting registration...');
    const registerRes = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Admin',
        email: 'testadmin@example.com',
        password: 'password123',
        role: 'admin'
      })
    });
    const registerData = await registerRes.json();
    console.log('Register:', registerData);
    const token = registerData.data?.token;

    if (token) {
      // Test get user
      console.log('\nTesting get current user...');
      const meRes = await fetch(`${API_URL}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log('Current User:', await meRes.json());
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
  }
}

testAPI();
export default testAPI;