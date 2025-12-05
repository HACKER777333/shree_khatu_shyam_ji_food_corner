// User Authentication System

// Admin credentials (for admin panel access)
const ADMIN_CREDENTIALS = {
    email: 'sj4597225@gmail.com',
    password: 'IAMDEVIL123'
};

function setLoginButtonState(isLoading) {
    const loginBtn = document.querySelector('#loginForm button[type="submit"]');
    if (!loginBtn) return;

    if (isLoading) {
        if (!loginBtn.dataset.originalText) {
            loginBtn.dataset.originalText = loginBtn.textContent;
        }
        loginBtn.textContent = 'Signing in...';
        loginBtn.disabled = true;
        loginBtn.classList.add('is-loading');
    } else {
        const defaultText = loginBtn.dataset.originalText || 'Login';
        loginBtn.textContent = defaultText;
        loginBtn.disabled = false;
        loginBtn.classList.remove('is-loading');
    }
}

function showLoginError(message) {
    const errorDiv = document.getElementById('loginErrorMessage');
    if (!errorDiv) return;
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

// Check if user is authenticated
function isUserAuthenticated() {
    const userData = localStorage.getItem('userAuth');
    if (!userData) return false;

    try {
        const user = JSON.parse(userData);
        return user && user.email && user.token;
    } catch (e) {
        return false;
    }
}

// Get current user
function getCurrentUser() {
    const userData = localStorage.getItem('userAuth');
    if (!userData) return null;

    try {
        return JSON.parse(userData);
    } catch (e) {
        return null;
    }
}

// Login function
async function handleLogin(event) {
    event.preventDefault();

    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginErrorMessage');

    // Clear previous errors
    if (errorDiv) {
        errorDiv.textContent = '';
        errorDiv.style.display = 'none';
    }

    let shouldResetButton = true;
    setLoginButtonState(true);

    // Check if admin credentials
    if (email === ADMIN_CREDENTIALS.email && password === ADMIN_CREDENTIALS.password) {
        const authData = {
            email: email,
            token: 'admin-token-' + Date.now(),
            loginTime: Date.now(),
            isAdmin: true
        };

        localStorage.setItem('adminAuth', JSON.stringify(authData));
        window.location.href = 'admin-dashboard.html';
        return;
    }

    // Regular user login - check with backend or Firebase
    try {
        const auth = getAuthInstance();
        if (auth) {
            // Firebase Login
            try {
                const userCredential = await auth.signInWithEmailAndPassword(email, password);
                const user = userCredential.user;

                // Store user data
                const token = await user.getIdToken();
                const userData = {
                    email: user.email,
                    name: user.displayName || user.email.split('@')[0],
                    phone: user.phoneNumber || '',
                    token: token,
                    loginTime: Date.now(),
                    isAdmin: false,
                    uid: user.uid
                };

                localStorage.setItem('userAuth', JSON.stringify(userData));
                shouldResetButton = false;

                // Load cart from server after login
                setTimeout(() => {
                    if (typeof loadCartFromServer === 'function') {
                        loadCartFromServer();
                    }
                }, 500);

                // Check if user was redirected from another page
                const returnAfterLogin = localStorage.getItem('returnAfterLogin');
                if (returnAfterLogin) {
                    localStorage.removeItem('returnAfterLogin');
                    window.location.href = returnAfterLogin;
                } else {
                    window.location.href = '/home';
                }
                return;
            } catch (firebaseError) {
                console.error('Firebase login error:', firebaseError);
                // Fallback to API login if Firebase fails (or if user not found in Firebase but exists in DB)
            }
        }

        const response = await fetch('/api/users/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const result = await response.json();

        if (result.success) {
            // Store user data
            const token = btoa(`${email}:${Date.now()}`);
            const userData = {
                email: result.user.email,
                name: result.user.name,
                phone: result.user.phone,
                token: token,
                loginTime: Date.now(),
                isAdmin: false
            };

            localStorage.setItem('userAuth', JSON.stringify(userData));
            shouldResetButton = false;

            // Load cart from server after login
            setTimeout(() => {
                if (typeof loadCartFromServer === 'function') {
                    loadCartFromServer();
                }
            }, 500);

            // Check if user was redirected from another page
            const returnAfterLogin = localStorage.getItem('returnAfterLogin');
            if (returnAfterLogin) {
                localStorage.removeItem('returnAfterLogin');
                window.location.href = returnAfterLogin;
            } else {
                window.location.href = '/home';
            }
        } else {
            showLoginError(result.message || 'Invalid email or password');
        }
    } catch (error) {
        console.error('Login error:', error);
        showLoginError('Unable to reach the server. Please check your connection and try again.');
    } finally {
        if (shouldResetButton) {
            setLoginButtonState(false);
        }
    }
}


// Google Login
async function handleGoogleLogin() {
    const auth = getAuthInstance();
    if (!auth) {
        showLoginError('Google Sign-In is not available at the moment.');
        return;
    }

    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await auth.signInWithPopup(provider);
        const user = result.user;

        // Sync with backend to ensure user exists in local DB (for admin panel)
        try {
            await fetch('/api/users/google-login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: user.email,
                    name: user.displayName || user.email.split('@')[0],
                    uid: user.uid,
                    phone: user.phoneNumber || ''
                })
            });
        } catch (syncError) {
            console.error('Failed to sync user with backend:', syncError);
            // Continue anyway as we have Firebase auth
        }

        // Store user data
        const token = await user.getIdToken();
        const userData = {
            email: user.email,
            name: user.displayName || user.email.split('@')[0],
            phone: user.phoneNumber || '',
            token: token,
            loginTime: Date.now(),
            isAdmin: false,
            uid: user.uid
        };

        localStorage.setItem('userAuth', JSON.stringify(userData));

        // Load cart from server after login
        setTimeout(() => {
            if (typeof loadCartFromServer === 'function') {
                loadCartFromServer();
            }
        }, 500);

        // Check if user was redirected from another page
        const returnAfterLogin = localStorage.getItem('returnAfterLogin');
        if (returnAfterLogin) {
            localStorage.removeItem('returnAfterLogin');
            window.location.href = returnAfterLogin;
        } else {
            window.location.href = '/home';
        }
    } catch (error) {
        console.error('Google login error:', error);
        showLoginError(error.message || 'Google Sign-In failed.');
    }
}

// Password Reset
async function handlePasswordReset(event) {
    event.preventDefault();
    const email = document.getElementById('resetEmail').value;
    const messageDiv = document.getElementById('resetMessage');
    const auth = getAuthInstance();

    if (!auth) {
        messageDiv.textContent = 'Password reset service is unavailable.';
        messageDiv.style.color = 'red';
        messageDiv.style.display = 'block';
        return;
    }

    try {
        await auth.sendPasswordResetEmail(email);
        messageDiv.textContent = 'Password reset email sent! Check your inbox.';
        messageDiv.style.color = 'green';
        messageDiv.style.display = 'block';
        document.getElementById('resetEmail').value = '';
    } catch (error) {
        console.error('Password reset error:', error);
        messageDiv.textContent = error.message || 'Failed to send reset email.';
        messageDiv.style.color = 'red';
        messageDiv.style.display = 'block';
    }
}

// Register function - Direct Firebase registration (no email verification)
async function handleRegister(event) {
    event.preventDefault();

    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    const phone = document.getElementById('regPhone').value;
    const errorDiv = document.getElementById('registerErrorMessage');
    const registerSubmitBtn = document.getElementById('registerSubmitBtn');

    // Clear previous errors
    errorDiv.textContent = '';
    errorDiv.style.display = 'none';

    // Check if trying to register with admin email
    if (email === ADMIN_CREDENTIALS.email) {
        errorDiv.textContent = 'This email is reserved for admin use.';
        errorDiv.style.display = 'block';
        return;
    }

    registerSubmitBtn.disabled = true;
    registerSubmitBtn.textContent = 'Creating account...';

    try {
        const auth = getAuthInstance();
        if (auth) {
            // Firebase Registration
            try {
                const userCredential = await auth.createUserWithEmailAndPassword(email, password);
                const user = userCredential.user;

                // Update profile with name
                await user.updateProfile({
                    displayName: name
                });

                // Store user data
                const token = await user.getIdToken();
                const userData = {
                    email: user.email,
                    name: name,
                    phone: phone, // Note: Firebase Auth doesn't store phone directly with email/pass, so we just store it locally or sync to Firestore if needed
                    token: token,
                    loginTime: Date.now(),
                    isAdmin: false,
                    uid: user.uid
                };

                localStorage.setItem('userAuth', JSON.stringify(userData));

                // Check if user was redirected from another page
                const returnAfterLogin = localStorage.getItem('returnAfterLogin');
                if (returnAfterLogin) {
                    localStorage.removeItem('returnAfterLogin');
                    window.location.href = returnAfterLogin;
                } else {
                    window.location.href = '/home';
                }
                return;
            } catch (firebaseError) {
                console.error('Firebase registration error:', firebaseError);
                // Fallback to API registration if Firebase fails
                if (firebaseError.code === 'auth/email-already-in-use') {
                    registerSubmitBtn.disabled = false;
                    registerSubmitBtn.textContent = 'Sign Up';
                    errorDiv.textContent = 'Email already in use. Please login instead.';
                    errorDiv.style.display = 'block';
                    return;
                }
            }
        }

        const response = await fetch('/api/users/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, email, password, phone })
        });

        const result = await response.json();

        if (result.success) {
            // Auto-login after registration
            const token = btoa(`${email}:${Date.now()}`);
            const userData = {
                email: result.user.email,
                name: result.user.name,
                phone: result.user.phone,
                token: token,
                loginTime: Date.now(),
                isAdmin: false
            };

            localStorage.setItem('userAuth', JSON.stringify(userData));

            // Check if user was redirected from another page
            const returnAfterLogin = localStorage.getItem('returnAfterLogin');
            if (returnAfterLogin) {
                localStorage.removeItem('returnAfterLogin');
                window.location.href = returnAfterLogin;
            } else {
                window.location.href = '/home';
            }
        } else {
            registerSubmitBtn.disabled = false;
            registerSubmitBtn.textContent = 'Sign Up';
            errorDiv.textContent = result.message || 'Registration failed. Please try again.';
            errorDiv.style.display = 'block';
        }
    } catch (error) {
        console.error('Registration error:', error);
        registerSubmitBtn.disabled = false;
        registerSubmitBtn.textContent = 'Sign Up';
        errorDiv.textContent = 'Error connecting to server. Please try again.';
        errorDiv.style.display = 'block';
    }
}


// Logout function
function userLogout() {
    if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('userAuth');
        localStorage.removeItem('adminAuth');
        window.location.href = 'login.html';
    }
}

// Protect pages that require authentication
function checkUserAuth() {
    const path = window.location.pathname;
    const normalizedPath = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
    const isHomeRoute = (
        normalizedPath === '/' ||
        normalizedPath === '/home' ||
        normalizedPath.endsWith('index.html')
    );
    const requiresAuth = (
        isHomeRoute
        // order-tracking.html does NOT require auth - anyone can track with order number
    );

    if (requiresAuth && !isUserAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }

    if (path.endsWith('login.html') && isUserAuthenticated()) {
        window.location.href = '/home';
    }
}

function updateAuthLinks() {
    const user = getCurrentUser();
    const userInfoEl = document.getElementById('userInfo');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginLink = document.getElementById('loginLink');
    const signupLink = document.getElementById('signupLink');

    if (!userInfoEl || !logoutBtn || !loginLink || !signupLink) return;

    if (user) {
        userInfoEl.textContent = `👤 ${user.name}`;
        userInfoEl.style.display = 'inline-block';
        logoutBtn.style.display = 'inline-block';
        loginLink.style.display = 'none';
        signupLink.style.display = 'none';
    } else {
        userInfoEl.style.display = 'none';
        logoutBtn.style.display = 'none';
        loginLink.style.display = 'inline-block';
        signupLink.style.display = 'inline-block';
    }
}

function initAuthScripts() {
    checkUserAuth();
    updateAuthLinks();
    initThemeToggle();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuthScripts);
} else {
    initAuthScripts();
}

// ==========================
// Theme toggle (dark / light)
// ==========================

const THEME_STORAGE_KEY = 'shophubTheme';

function applyTheme(theme) {
    const body = document.body;
    const finalTheme = theme === 'light' ? 'light' : 'dark';

    if (finalTheme === 'light') {
        body.classList.add('light-theme');
    } else {
        body.classList.remove('light-theme');
    }

    const btn = document.getElementById('themeToggleBtn');
    if (btn) {
        btn.textContent = finalTheme === 'light' ? '🌙 Dark' : '☀️ Light';
    }
}

function initThemeToggle() {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) || 'dark';
    applyTheme(saved);

    const btn = document.getElementById('themeToggleBtn');
    if (!btn) return;

    btn.addEventListener('click', () => {
        const isLight = document.body.classList.contains('light-theme');
        const nextTheme = isLight ? 'dark' : 'light';
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        applyTheme(nextTheme);
    });
}

