import { getAuth } from 'firebase/auth';
import { invoke } from '../filesystem/tauriCommands';

export async function createCheckoutSession(productId: string): Promise<void> {
  console.log('[creemService] createCheckoutSession called with productId:', productId);
  try {
    const auth = getAuth();
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
    
    const baseUrl = import.meta.env.VITE_MODAL_BASE_URL || '';
    if (!baseUrl) {
      throw new Error('VITE_MODAL_BASE_URL is not configured.');
    }
    
    const response = await fetch(`${baseUrl}/create-checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ productId })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server returned error: ${errorText}`);
    }
    
    const result = await response.json();
    if (result.url) {
      await invoke('open_browser_url', { url: result.url });
    } else {
      throw new Error('No checkout URL returned from server.');
    }
  } catch (error) {
    console.error('Failed to create checkout session:', error);
    // Fallback simulation for local/offline testing
    const confirmSimulation = confirm(
      'Could not connect to Modal billing functions. Run mock subscription checkout instead?'
    );
    if (confirmSimulation) {
      const mockUrl = `https://creem.io/payment/${productId}`;
      await invoke('open_browser_url', { url: mockUrl });
    }
  }
}

export async function createPortalSession(): Promise<void> {
  try {
    const auth = getAuth();
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
    
    const baseUrl = import.meta.env.VITE_MODAL_BASE_URL || '';
    if (!baseUrl) {
      throw new Error('VITE_MODAL_BASE_URL is not configured.');
    }
    
    const response = await fetch(`${baseUrl}/create-portal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server returned error: ${errorText}`);
    }
    
    const result = await response.json();
    if (result.url) {
      await invoke('open_browser_url', { url: result.url });
    } else {
      throw new Error('No billing portal URL returned.');
    }
  } catch (error) {
    console.error('Failed to create billing portal session:', error);
    // Fallback simulation for local/offline testing
    alert('[Simulation] Redirecting to mock Creem Customer Portal');
    await invoke('open_browser_url', { url: 'https://portal.creem.io' });
  }
}
