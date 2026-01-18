// Auth UI Module
import { signIn, signUp, signInWithGoogle, logOut, onAuthChange, getCurrentUser } from './firebase-config.js';

// Auth Modal State
let authModal = null;
let isSignUp = false;

// Create Auth Modal
export function createAuthModal() {
    const modal = document.createElement('div');
    modal.id = 'auth-modal';
    modal.className = 'auth-modal hidden';
    modal.innerHTML = `
    <div class="auth-modal__backdrop"></div>
    <div class="auth-modal__content">
      <button class="auth-modal__close" id="auth-close">&times;</button>
      <h2 class="auth-modal__title" id="auth-title">Sign In</h2>
      
      <form id="auth-form" class="auth-form">
        <div class="form-group">
          <label for="auth-email">Email</label>
          <input type="email" id="auth-email" placeholder="you@example.com" required>
        </div>
        <div class="form-group">
          <label for="auth-password">Password</label>
          <input type="password" id="auth-password" placeholder="••••••••" required minlength="6">
        </div>
        <div id="auth-error" class="auth-error hidden"></div>
        <button type="submit" class="btn btn--primary btn--block" id="auth-submit">Sign In</button>
      </form>
      
      <div class="auth-divider"><span>or</span></div>
      
      <button id="google-signin" class="btn btn--ghost btn--block google-btn">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continue with Google
      </button>
      
      <p class="auth-switch">
        <span id="auth-switch-text">Don't have an account?</span>
        <button type="button" id="auth-toggle" class="auth-toggle">Sign Up</button>
      </p>
    </div>
  `;
    document.body.appendChild(modal);
    authModal = modal;

    // Event Listeners
    modal.querySelector('.auth-modal__backdrop').addEventListener('click', closeAuthModal);
    modal.querySelector('#auth-close').addEventListener('click', closeAuthModal);
    modal.querySelector('#auth-toggle').addEventListener('click', toggleAuthMode);
    modal.querySelector('#auth-form').addEventListener('submit', handleAuthSubmit);
    modal.querySelector('#google-signin').addEventListener('click', handleGoogleSignIn);

    return modal;
}

// Open Auth Modal
export function openAuthModal(signUpMode = false) {
    if (!authModal) createAuthModal();
    isSignUp = signUpMode;
    updateAuthMode();
    authModal.classList.remove('hidden');
    document.getElementById('auth-email').focus();
}

// Close Auth Modal
export function closeAuthModal() {
    if (authModal) {
        authModal.classList.add('hidden');
        document.getElementById('auth-form').reset();
        hideError();
    }
}

// Toggle between Sign In / Sign Up
function toggleAuthMode() {
    isSignUp = !isSignUp;
    updateAuthMode();
}

function updateAuthMode() {
    document.getElementById('auth-title').textContent = isSignUp ? 'Sign Up' : 'Sign In';
    document.getElementById('auth-submit').textContent = isSignUp ? 'Sign Up' : 'Sign In';
    document.getElementById('auth-switch-text').textContent = isSignUp ? 'Already have an account?' : "Don't have an account?";
    document.getElementById('auth-toggle').textContent = isSignUp ? 'Sign In' : 'Sign Up';
}

// Handle Form Submit
async function handleAuthSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const submitBtn = document.getElementById('auth-submit');

    submitBtn.disabled = true;
    submitBtn.textContent = isSignUp ? 'Signing up...' : 'Signing in...';
    hideError();

    try {
        if (isSignUp) {
            await signUp(email, password);
        } else {
            await signIn(email, password);
        }
        // Success - Redirect
        // Note: onAuthChange in landing.html will also trigger, but this is faster for email auth
        window.location.href = '/dashboard';
    } catch (error) {
        console.error('Auth error:', error);
        showError(getErrorMessage(error.code));
        submitBtn.disabled = false;
        updateAuthMode(); // Reset button text
    }
}

// Handle Google Sign In
async function handleGoogleSignIn() {
    const btn = document.getElementById('google-signin');
    btn.disabled = true;
    btn.innerHTML = 'Redirecting...';
    hideError();

    try {
        // This triggers a full page redirect
        await signInWithGoogle();
        // Code below this line won't execute if redirect works
    } catch (error) {
        console.error('Google Auth error:', error);
        showError(getErrorMessage(error.code));
        btn.disabled = false;
        btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continue with Google`;
    }
}

// Error Handling
function showError(message) {
    const errorEl = document.getElementById('auth-error');
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
}

function hideError() {
    document.getElementById('auth-error')?.classList.add('hidden');
}

function getErrorMessage(code) {
    const messages = {
        'auth/email-already-in-use': 'This email is already registered',
        'auth/invalid-email': 'Invalid email address',
        'auth/weak-password': 'Password should be at least 6 characters',
        'auth/user-not-found': 'No account found with this email',
        'auth/wrong-password': 'Incorrect password',
        'auth/popup-closed-by-user': 'Sign in cancelled',
        'auth/invalid-credential': 'Invalid email or password',
    };
    return messages[code] || 'Something went wrong. Please try again.';
}

// Check if user is authenticated
export function requireAuth(redirectTo = '/') {
    return new Promise((resolve) => {
        onAuthChange((user) => {
            if (user) {
                resolve(user);
            } else {
                window.location.href = redirectTo;
            }
        });
    });
}

// Export for global use
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
export { logOut, onAuthChange, getCurrentUser };
