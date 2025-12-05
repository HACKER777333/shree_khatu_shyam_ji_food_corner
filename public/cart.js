// Cart Page JavaScript with Real-time Sync

let cart = [];

// Initialize cart page
document.addEventListener('DOMContentLoaded', () => {
    updateAuthUI();
    // Load cart (from server for logged-in users)
    loadCart();
    // Basic sync when cart is updated from other pages
    setupCartSync();
});

// Update authentication UI
function updateAuthUI() {
    if (typeof isUserAuthenticated === 'function' && isUserAuthenticated()) {
        const user = getCurrentUser();
        if (user) {
            const userInfoEl = document.getElementById('userInfo');
            const logoutBtn = document.getElementById('logoutBtn');
            const loginLink = document.getElementById('loginLink');
            const signupLink = document.getElementById('signupLink');

            if (userInfoEl) {
                userInfoEl.textContent = `👤 ${user.name}`;
                userInfoEl.style.display = 'inline-block';
            }
            if (logoutBtn) logoutBtn.style.display = 'inline-block';
            if (loginLink) loginLink.style.display = 'none';
            if (signupLink) signupLink.style.display = 'none';
        }
    } else {
        const userInfoEl = document.getElementById('userInfo');
        const logoutBtn = document.getElementById('logoutBtn');
        const loginLink = document.getElementById('loginLink');
        const signupLink = document.getElementById('signupLink');

        if (userInfoEl) userInfoEl.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (loginLink) loginLink.style.display = 'inline-block';
        if (signupLink) signupLink.style.display = 'inline-block';
    }
}

// Load cart from server (or keep in-memory for guests)
function loadCart() {
    // If user is logged in, load from server
    if (typeof isUserAuthenticated === 'function' && isUserAuthenticated()) {
        loadCartFromServer();
        return;
    }

    // Guest users: load from localStorage
    const savedCart = localStorage.getItem('guestCart');
    if (savedCart) {
        try {
            cart = JSON.parse(savedCart);
        } catch (e) {
            console.error('Error parsing guest cart:', e);
            cart = [];
        }
    } else {
        cart = [];
    }
    updateCartDisplay();
}

// Load cart from server
async function loadCartFromServer() {
    if (typeof isUserAuthenticated !== 'function' || !isUserAuthenticated()) {
        return;
    }

    const user = getCurrentUser();
    if (!user || !user.email) {
        return;
    }

    try {
        const response = await fetch(`/api/cart/load?email=${encodeURIComponent(user.email)}`);
        if (response.ok) {
            const data = await response.json();
            if (data.success && Array.isArray(data.cart)) {
                cart = data.cart;
                console.log('Cart loaded from server on cart page:', cart);
            }
        }
    } catch (error) {
        console.error('[Cart Page] Error loading cart:', error);
    }

    updateCartDisplay();
}

// Setup real-time cart sync
function setupCartSync() {
    // When products page saves cart, it can dispatch 'cartUpdated' if on same tab.
    window.addEventListener('cartUpdated', () => {
        loadCart();
    });

    // Listen for localStorage changes (cross-tab sync for guests)
    window.addEventListener('storage', (e) => {
        if (e.key === 'guestCart') {
            // Only reload if we are a guest
            if (typeof isUserAuthenticated === 'function' && !isUserAuthenticated()) {
                console.log('Guest cart updated in another tab');
                loadCart();
            }
        }
    });
}

// Update cart display
function updateCartDisplay() {
    const container = document.getElementById('cartItemsContainer');
    const cartCount = document.getElementById('cartCount');
    const cartSubtotal = document.getElementById('cartSubtotal');
    const cartTotal = document.getElementById('cartTotal');
    const checkoutBtn = document.getElementById('checkoutBtn');

    console.log('Updating cart display. Cart items:', cart.length, cart);

    // Update cart count in header
    const totalItems = cart.reduce((sum, item) => sum + (item.quantity || 0), 0);
    if (cartCount) {
        cartCount.textContent = totalItems;
        cartCount.style.display = totalItems > 0 ? 'flex' : 'none';
    }

    if (!container) {
        console.warn('Cart container not found!');
        return;
    }

    if (cart.length === 0) {
        container.innerHTML = `
            <div class="empty-cart-message">
                <h2>Your cart is empty</h2>
                <p>Add some items to your cart to get started!</p>
                <a href="maal.html" class="continue-shopping-btn">Continue Shopping</a>
            </div>
        `;
        if (checkoutBtn) {
            checkoutBtn.disabled = true;
        }
        if (cartSubtotal) cartSubtotal.textContent = '₹0.00';
        if (cartTotal) cartTotal.textContent = '₹0.00';
        return;
    }

    // Display cart items
    if (cart.length > 0) {
        container.innerHTML = cart.map(item => {
            // Ensure all required fields exist
            const itemId = item.id || 0;
            const itemName = item.name || 'Unknown Product';
            const itemPrice = item.price || 0;
            const itemQuantity = item.quantity || 1;
            const itemImage = item.image || 'https://via.placeholder.com/150';

            return `
                <div class="cart-item-card">
                    <img src="${itemImage}" 
                         alt="${itemName}" 
                         class="cart-item-image"
                         onerror="this.src='https://via.placeholder.com/150'">
                    <div class="cart-item-details">
                        <div class="cart-item-name">${itemName}</div>
                        <div class="cart-item-price">₹${itemPrice.toFixed(2)}</div>
                        <div class="cart-item-quantity-controls">
                            <button class="quantity-btn" onclick="updateQuantity(${itemId}, -1)">-</button>
                            <span class="quantity-display">${itemQuantity}</span>
                            <button class="quantity-btn" onclick="updateQuantity(${itemId}, 1)">+</button>
                        </div>
                        <button class="remove-item-btn" onclick="removeFromCart(${itemId})">Remove</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Calculate totals
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    if (cartSubtotal) cartSubtotal.textContent = `₹${subtotal.toFixed(2)}`;
    if (cartTotal) cartTotal.textContent = `₹${subtotal.toFixed(2)}`;
    if (checkoutBtn) {
        checkoutBtn.disabled = false;
    }
}

// Update quantity
function updateQuantity(productId, change) {
    const item = cart.find(item => item.id === productId);
    if (!item) return;

    item.quantity += change;
    if (item.quantity <= 0) {
        removeFromCart(productId);
    } else {
        saveCart();
        updateCartDisplay();
        // Dispatch event to sync with other pages
        window.dispatchEvent(new CustomEvent('cartUpdated'));
    }
}

// Remove from cart
function removeFromCart(productId) {
    const productName = cart.find(item => item.id === productId)?.name || 'Item';
    cart = cart.filter(item => item.id !== productId);
    saveCart();
    updateCartDisplay();
    showNotification(`${productName} removed from cart!`);
    // Dispatch event to sync with other pages
    window.dispatchEvent(new CustomEvent('cartUpdated'));
}

// Save cart
function saveCart() {
    // If user is logged in, sync with server via API
    if (typeof isUserAuthenticated === 'function' && isUserAuthenticated()) {
        const user = getCurrentUser();
        if (user && user.email) {
            fetch('/api/cart/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: user.email,
                    cart: cart
                })
            }).then(() => {
                window.dispatchEvent(new CustomEvent('cartUpdated'));
            }).catch(error => {
                console.error('Error syncing cart to server:', error);
            });
        }
    } else {
        // Guest user: save to localStorage
        localStorage.setItem('guestCart', JSON.stringify(cart));
        window.dispatchEvent(new CustomEvent('cartUpdated'));
    }
}

// Proceed to checkout
function proceedToCheckout() {
    if (cart.length === 0) {
        showNotification('Your cart is empty!', 'error');
        return;
    }

    if (typeof isUserAuthenticated === 'function' && !isUserAuthenticated()) {
        if (confirm('Please login to continue with checkout. Would you like to login now?')) {
            localStorage.setItem('returnAfterLogin', window.location.pathname || '/cart.html');
            window.location.href = '/login.html';
        }
        return;
    }

    window.location.href = '/checkout.html';
}

// Show notification
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    const bgColor = type === 'error' ? '#dc3545' : '#28a745';
    notification.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        background: ${bgColor};
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: slideIn 0.3s;
        font-weight: 500;
        max-width: 300px;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%) scale(0.8);
            opacity: 0;
        }
        to {
            transform: translateX(0) scale(1);
            opacity: 1;
        }
    }
    @keyframes slideOut {
        from {
            transform: translateX(0) scale(1);
            opacity: 1;
        }
        to {
            transform: translateX(100%) scale(0.8);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

