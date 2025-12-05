// Admin Authentication using localStorage

const ADMIN_CREDENTIALS = {
    email: 'sj4597225@gmail.com',
    password: 'IAMDEVIL123'
};

// Check if user is authenticated
function isAuthenticated() {
    const authData = localStorage.getItem('adminAuth');
    if (!authData) return false;
    
    try {
        const auth = JSON.parse(authData);
        // Check if token exists and is valid (simple check)
        return auth && auth.token && auth.email === ADMIN_CREDENTIALS.email;
    } catch (e) {
        return false;
    }
}

// Login function (for old admin-login.html page - redirects to new login)
function handleLogin(event) {
    event.preventDefault();
    // Redirect to new unified login page
    window.location.href = 'login.html';
}

// Logout function
function logout() {
    if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('adminAuth');
        window.location.href = 'admin-login.html';
    }
}

// Protect admin pages
function checkAuth() {
    if (window.location.pathname.includes('admin-dashboard.html') || 
        window.location.pathname.includes('admin-dashboard')) {
        if (!isAuthenticated()) {
            window.location.href = 'admin-login.html';
        }
    }
    
    if (window.location.pathname.includes('admin-login.html') || 
        window.location.pathname.includes('admin-login')) {
        if (isAuthenticated()) {
            window.location.href = 'admin-dashboard.html';
        }
    }
}

// Check authentication on page load
function initAuth() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkAuth);
    } else {
        checkAuth();
    }
}

// Initialize auth check
initAuth();

