const API_BASE_URL = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000') + '/api';

export async function fetchJson(url, options = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_BASE_URL}${url}`, {
      headers,
      ...options,
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
    });
    if (!response.ok) {
      let errorMessage = 'Something went wrong';
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorMessage;
      } catch (parseError) {
        errorMessage = `HTTP Error ${response.status}: ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }
    
    // Safely handle empty responses (like 204 No Content)
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch (parseError) {
      return { data: text }; // Fallback for plain-text responses
    }
  } catch (error) {
    throw error;
  }
}